/**
 * scripts/regenerate-glossary-seed.mjs
 *
 * Regenerates scripts/migrate-glossary-data.sql from src/data/glossary.json.
 * Emits idempotent upsert SQL (ON CONFLICT DO UPDATE) — safe to re-run against
 * a live D1 that already has admin-edited rows.
 *
 * This replaces the one-shot parse-glossary-to-seed.mjs now that D1 is SSOT.
 * The JSON file is itself refreshed from D1 via `npm run fetch-glossary`.
 *
 * To wipe the glossary entirely before re-seeding, run scripts/reset-glossary-data.sql.
 *
 * Run: node scripts/regenerate-glossary-seed.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_JSON = join(__dirname, '..', 'src', 'data', 'glossary.json');
const OUT_SQL = join(__dirname, 'migrate-glossary-data.sql');

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function main() {
  const data = JSON.parse(readFileSync(IN_JSON, 'utf-8'));
  const terms = data.terms ?? [];
  const refs = data.references ?? [];

  if (terms.length < 100) {
    throw new Error(`Refusing to emit seed: only ${terms.length} terms (min 100). Source may be broken.`);
  }
  if (refs.length < 30) {
    throw new Error(`Refusing to emit seed: only ${refs.length} references (min 30). Source may be broken.`);
  }

  // Verify slug uniqueness
  const slugs = new Set();
  for (const t of terms) {
    if (!t.slug || slugs.has(t.slug)) {
      throw new Error(`Duplicate or missing slug: ${t.slug}`);
    }
    slugs.add(t.slug);
  }

  const lines = [];
  lines.push('-- scripts/migrate-glossary-data.sql');
  lines.push('-- Auto-generated from src/data/glossary.json by regenerate-glossary-seed.mjs');
  lines.push(`-- Terms: ${terms.length}, References: ${refs.length}`);
  lines.push('-- Run AFTER migrate-glossary-to-d1.sql (creates tables).');
  lines.push('--');
  lines.push('-- IDEMPOTENT UPSERT: safe to re-run. Existing rows are updated from source.');
  lines.push('-- Rows that exist in D1 but not in source are NOT deleted (admin edits preserved).');
  lines.push('-- To wipe the glossary entirely, run scripts/reset-glossary-data.sql first.');
  lines.push('--');
  lines.push('-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-glossary-data.sql');
  lines.push('');
  lines.push('-- Terms (upsert by slug)');
  for (const t of terms) {
    const id = t.id || `term_${t.slug}`;
    lines.push(
      `INSERT INTO glossary_term (id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status) VALUES (${sqlEscape(id)}, ${sqlEscape(t.slug)}, ${sqlEscape(t.name)}, ${sqlEscape(t.part)}, ${t.sortOrder}, ${sqlEscape(t.bodyHtml)}, ${sqlEscape(t.abbreviation)}, ${sqlEscape(t.pillarLink)}, ${sqlEscape(t.status || 'published')}) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, part=excluded.part, sort_order=excluded.sort_order, body_html=excluded.body_html, abbreviation=excluded.abbreviation, pillar_link=excluded.pillar_link, updated_at=datetime('now');`
    );
  }
  lines.push('');
  lines.push('-- References (upsert by ref_num)');
  for (const r of refs) {
    lines.push(
      `INSERT INTO glossary_reference (ref_num, anchor_text, url, publisher, journal) VALUES (${r.refNum}, ${sqlEscape(r.anchorText)}, ${sqlEscape(r.url)}, ${sqlEscape(r.publisher)}, ${sqlEscape(r.journal)}) ON CONFLICT(ref_num) DO UPDATE SET anchor_text=excluded.anchor_text, url=excluded.url, publisher=excluded.publisher, journal=excluded.journal;`
    );
  }

  writeFileSync(OUT_SQL, lines.join('\n') + '\n');
  console.log(`Wrote ${OUT_SQL}`);
  console.log(`  ${terms.length} term upserts`);
  console.log(`  ${refs.length} reference upserts`);
}

main();
