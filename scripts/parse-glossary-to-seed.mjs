/**
 * scripts/parse-glossary-to-seed.mjs
 *
 * ============================================================================
 * ARCHIVE ONLY — DO NOT RUN AFTER 2026-04-17.
 *
 * This was the one-shot migration tool that parsed the monolithic
 * src/pages/glossary/index.astro (pre-migration) into D1 seed SQL + JSON.
 *
 * Since 2026-04-17, the Astro page is data-driven. This script can no longer
 * find the part <section> blocks (they're rendered via .map() at build time),
 * so running it throws "Section not found".
 *
 * For ongoing regeneration: use scripts/regenerate-glossary-seed.mjs, which
 * reads from src/data/glossary.json (D1 is the true source of truth).
 *
 * Kept in the repo only as historical context for the migration.
 * ============================================================================
 */
throw new Error(
  'parse-glossary-to-seed.mjs is ARCHIVE ONLY. Use regenerate-glossary-seed.mjs instead.'
);
/* eslint-disable */
/* istanbul ignore file */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dirname, '..', 'src', 'pages', 'glossary', 'index.astro');
const OUT = join(__dirname, 'migrate-glossary-data.sql');
const OUT_JSON = join(__dirname, '..', 'src', 'data', 'glossary.json');

const PART_SECTIONS = [
  { part: 'I',    sectionId: 'core-rrm-principles' },
  { part: 'II',   sectionId: 'fertility-awareness' },
  { part: 'III',  sectionId: 'clinical-approaches' },
  { part: 'IV',   sectionId: 'diagnostic-tools' },
  { part: 'V',    sectionId: 'surgical-techniques' },
  { part: 'VI',   sectionId: 'conditions' },
  { part: 'VII',  sectionId: 'overlapping-disciplines' },
  { part: 'VIII', sectionId: 'broader-framework' },
];

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

/**
 * Extract the inner content of a <section id="X"> ... </section>.
 * Sections in this file do not nest, so a single non-greedy regex is safe.
 */
function extractSection(text, sectionId) {
  const re = new RegExp(
    `<section id="${sectionId}">([\\s\\S]*?)\\n\\s*</section>`,
    'm'
  );
  const m = text.match(re);
  if (!m) throw new Error(`Section not found: ${sectionId}`);
  return m[1];
}

/**
 * Split a part-section body into [{ slug, name, pillarLink, bodyHtml }].
 *
 * Finds each <h3 id="slug">...</h3> and captures the body up to the next
 * <h3> or end of section. Handles h3s with inner <a> (pillar links).
 */
function parseTerms(sectionBody) {
  const terms = [];
  const h3Re = /<h3 id="([^"]+)">([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3 id="|\s*$)/g;
  let match;
  while ((match = h3Re.exec(sectionBody)) !== null) {
    const [, slug, nameInner, body] = match;
    let name = nameInner.trim();
    let pillarLink = null;
    const linkMatch = name.match(/^<a href="([^"]+)">([\s\S]+?)<\/a>$/);
    if (linkMatch) {
      pillarLink = linkMatch[1];
      name = linkMatch[2].trim();
    }
    terms.push({
      slug,
      name,
      pillarLink,
      bodyHtml: body.trim(),
    });
  }
  return terms;
}

/**
 * Extract the parenthetical abbreviation from a term name.
 * "Basal Body Temperature (BBT)" -> "BBT"
 * Returns null if no parenthetical or the inner text is multi-word prose.
 */
function extractAbbreviation(name) {
  const m = name.match(/\(([^)]+)\)\s*$/);
  if (!m) return null;
  const inner = m[1].trim();
  // Accept all-caps, "with-hyphens", digit-prefixed (e.g. "5-MTHF"),
  // or slash-separated (e.g. "DFI"). Reject prose ("for Endometriosis").
  if (/^[A-Z][A-Z0-9\-\/\s]{0,30}$/.test(inner) && inner.length <= 12) {
    return inner;
  }
  // Special cases: "CrMS", "hCG" (mixed case but still an abbreviation)
  if (/^[A-Za-z]{2,8}$/.test(inner) && /[A-Z]/.test(inner)) {
    return inner;
  }
  return null;
}

/**
 * Parse the references section into [{ refNum, anchorText, url, publisher, journal }].
 */
function parseReferences(text) {
  const secMatch = text.match(
    /<section class="references" id="references">[\s\S]*?<ol>([\s\S]*?)<\/ol>/
  );
  if (!secMatch) throw new Error('References section not found');
  const listBody = secMatch[1];

  const refs = [];
  const liRe = /<li id="ref-(\d+)">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(listBody)) !== null) {
    const refNum = parseInt(m[1], 10);
    const inner = m[2].trim();
    // Pattern: <a href="URL" ...>ANCHOR</a>.PUBLISHER_OR_JOURNAL.
    const aMatch = inner.match(
      /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\.([\s\S]*?)\.?\s*$/
    );
    if (!aMatch) {
      console.warn(`Skipping malformed reference ref-${refNum}`);
      continue;
    }
    const [, url, anchorText, tail] = aMatch;
    // tail may be "PUBLISHER." or "<em>Journal</em>." -- try to split.
    let publisher = null;
    let journal = null;
    const tailTrim = tail.trim().replace(/\.$/, '');
    const emMatch = tailTrim.match(/^<em>(.+?)<\/em>$/);
    if (emMatch) {
      journal = emMatch[1].trim();
    } else {
      publisher = tailTrim;
    }
    refs.push({
      refNum,
      anchorText: anchorText.trim().replace(/<\/?em>/g, ''),
      url,
      publisher,
      journal,
    });
  }
  return refs;
}

function main() {
  const text = readFileSync(SOURCE, 'utf-8');

  const allTerms = [];
  for (const { part, sectionId } of PART_SECTIONS) {
    const body = extractSection(text, sectionId);
    const terms = parseTerms(body);
    terms.forEach((t, idx) => {
      allTerms.push({
        ...t,
        part,
        sortOrder: idx,
        abbreviation: extractAbbreviation(t.name),
      });
    });
    console.log(`Part ${part} (${sectionId}): ${terms.length} terms`);
  }
  console.log(`\nTotal terms: ${allTerms.length}`);

  const refs = parseReferences(text);
  console.log(`Total references: ${refs.length}`);

  // Check slug uniqueness
  const slugs = new Set();
  for (const t of allTerms) {
    if (slugs.has(t.slug)) {
      throw new Error(`Duplicate slug: ${t.slug}`);
    }
    slugs.add(t.slug);
  }

  // Emit SQL. Idempotent upserts via ON CONFLICT — safe to re-run against a
  // live D1 that already has admin-edited rows. This seed will update fields
  // from source but preserves rows not present in the source (intentional).
  // To wipe the glossary entirely, run scripts/reset-glossary-data.sql first.
  const sqlLines = [];
  sqlLines.push('-- scripts/migrate-glossary-data.sql');
  sqlLines.push('-- Auto-generated from src/pages/glossary/index.astro');
  sqlLines.push(`-- Terms: ${allTerms.length}, References: ${refs.length}`);
  sqlLines.push('-- Run AFTER migrate-glossary-to-d1.sql (creates tables).');
  sqlLines.push('--');
  sqlLines.push('-- IDEMPOTENT UPSERT: safe to re-run. Existing rows are updated from source.');
  sqlLines.push('-- Rows that exist in D1 but not in source are NOT deleted (admin edits preserved).');
  sqlLines.push('-- To wipe the glossary entirely, run scripts/reset-glossary-data.sql first.');
  sqlLines.push('--');
  sqlLines.push(
    '-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/migrate-glossary-data.sql'
  );
  sqlLines.push('');
  sqlLines.push('-- Terms (upsert by slug)');
  for (const t of allTerms) {
    const id = `term_${t.slug}`;
    sqlLines.push(
      `INSERT INTO glossary_term (id, slug, name, part, sort_order, body_html, abbreviation, pillar_link, status) VALUES (${sqlEscape(id)}, ${sqlEscape(t.slug)}, ${sqlEscape(t.name)}, ${sqlEscape(t.part)}, ${t.sortOrder}, ${sqlEscape(t.bodyHtml)}, ${sqlEscape(t.abbreviation)}, ${sqlEscape(t.pillarLink)}, 'published') ON CONFLICT(slug) DO UPDATE SET name=excluded.name, part=excluded.part, sort_order=excluded.sort_order, body_html=excluded.body_html, abbreviation=excluded.abbreviation, pillar_link=excluded.pillar_link, updated_at=datetime('now');`
    );
  }
  sqlLines.push('');
  sqlLines.push('-- References (upsert by ref_num)');
  for (const r of refs) {
    sqlLines.push(
      `INSERT INTO glossary_reference (ref_num, anchor_text, url, publisher, journal) VALUES (${r.refNum}, ${sqlEscape(r.anchorText)}, ${sqlEscape(r.url)}, ${sqlEscape(r.publisher)}, ${sqlEscape(r.journal)}) ON CONFLICT(ref_num) DO UPDATE SET anchor_text=excluded.anchor_text, url=excluded.url, publisher=excluded.publisher, journal=excluded.journal;`
    );
  }

  writeFileSync(OUT, sqlLines.join('\n') + '\n');
  console.log(`\nWrote ${OUT}`);
  console.log(`  ${allTerms.length} term INSERTs`);
  console.log(`  ${refs.length} reference INSERTs`);

  // Also emit glossary.json in the same shape the /api/glossary/terms endpoint returns.
  // This lets the Astro template build locally without the endpoint deployed.
  const jsonPayload = {
    terms: allTerms.map(t => ({
      id: `term_${t.slug}`,
      slug: t.slug,
      name: t.name,
      part: t.part,
      sortOrder: t.sortOrder,
      bodyHtml: t.bodyHtml,
      abbreviation: t.abbreviation,
      pillarLink: t.pillarLink,
      status: 'published',
    })),
    references: refs.map(r => ({
      refNum: r.refNum,
      anchorText: r.anchorText,
      url: r.url,
      publisher: r.publisher,
      journal: r.journal,
    })),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(OUT_JSON, JSON.stringify(jsonPayload, null, 2));
  console.log(`Wrote ${OUT_JSON} (${jsonPayload.terms.length} terms, ${jsonPayload.references.length} refs)`);
}

main();
