#!/usr/bin/env node
/**
 * Import CRM contacts into newsletter_subscriber table.
 *
 * Only imports contacts with safe ELV statuses (ok, ok_for_all).
 * Optionally includes risky contacts (accept_all, antispam_system, etc.)
 * with --include-risky flag.
 *
 * Prerequisites:
 *   - CRM contacts populated (build-contact-crm.mjs + import-wix-contacts.mjs)
 *   - ELV tags written (verify-crm-elv.mjs --tag)
 *
 * Usage:
 *   node scripts/import-newsletter-subscribers.mjs                  # safe only (ok, ok_for_all)
 *   node scripts/import-newsletter-subscribers.mjs --include-risky  # + accept_all, antispam_system, etc.
 *   node scripts/import-newsletter-subscribers.mjs --dry-run        # report only
 *   node scripts/import-newsletter-subscribers.mjs --db=rrm-auth
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const INCLUDE_RISKY = process.argv.includes('--include-risky');
const DRY_RUN = process.argv.includes('--dry-run');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';

const CWD = process.env.HOME + '/iCode/projects/rrm-academy-cf';

// Safe ELV statuses -- definitely sendable
const SAFE = new Set(['elv:ok', 'elv:ok_for_all']);

// Risky but possibly deliverable
const RISKY = new Set([
  'elv:accept_all', 'elv:antispam_system', 'elv:unknown',
  'elv:risky', 'elv:role', 'elv:smtp_protocol', 'elv:error',
]);

function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8', cwd: CWD, maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`d1Query: no JSON:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/newsletter-import-batch.sql';
  writeFileSync(tmpFile, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile}`, {
      encoding: 'utf8', cwd: CWD, maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  console.log(`\n=== Newsletter Subscriber Import [DB: ${DB_NAME}] ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Include risky: ${INCLUDE_RISKY}\n`);

  // Get all contacts with ELV tags
  const contacts = d1Query(`
    SELECT c.id, c.email, c.first_name, c.last_name, ct.tag
    FROM contact c
    JOIN contact_tag ct ON ct.contact_id = c.id
    WHERE ct.tag LIKE 'elv:%'
      AND c.email NOT LIKE 'merged:%'
    ORDER BY c.email
  `);

  console.log(`Contacts with ELV tags: ${contacts.length}`);

  // Tally by status
  const tagCounts = {};
  for (const c of contacts) {
    tagCounts[c.tag] = (tagCounts[c.tag] || 0) + 1;
  }
  console.log('\nELV status breakdown:');
  for (const [tag, count] of Object.entries(tagCounts).sort((a, b) => b[1] - a[1])) {
    const action = SAFE.has(tag) ? 'IMPORT' : RISKY.has(tag) ? (INCLUDE_RISKY ? 'IMPORT (risky)' : 'SKIP (risky)') : 'BLOCK';
    console.log(`  ${tag.padEnd(25)} ${String(count).padStart(5)}  ${action}`);
  }

  // Filter to importable contacts
  const allowedTags = new Set([...SAFE]);
  if (INCLUDE_RISKY) {
    for (const t of RISKY) allowedTags.add(t);
  }

  const toImport = contacts.filter(c => allowedTags.has(c.tag));

  // Deduplicate by email (a contact might have multiple tags)
  const byEmail = new Map();
  for (const c of toImport) {
    if (!byEmail.has(c.email)) byEmail.set(c.email, c);
  }
  const importList = [...byEmail.values()];

  // Check existing subscribers to avoid duplicates
  const existingSubs = d1Query("SELECT email FROM newsletter_subscriber");
  const existingEmails = new Set(existingSubs.map(s => s.email?.toLowerCase()));
  const newSubs = importList.filter(c => !existingEmails.has(c.email?.toLowerCase()));

  console.log(`\nExisting subscribers: ${existingSubs.length}`);
  console.log(`Importable contacts: ${importList.length}`);
  console.log(`New to import: ${newSubs.length}`);
  console.log(`Already subscribed: ${importList.length - newSubs.length}`);

  if (DRY_RUN || newSubs.length === 0) {
    if (DRY_RUN) console.log('\nDry run -- no changes made.');
    return;
  }

  // Import in batches
  console.log(`\nImporting ${newSubs.length} subscribers...`);
  const BATCH = 50;
  let imported = 0;

  for (let i = 0; i < newSubs.length; i += BATCH) {
    const batch = newSubs.slice(i, i + BATCH);
    const stmts = batch.map(c => {
      const id = crypto.randomUUID();
      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
      return `INSERT OR IGNORE INTO newsletter_subscriber (id, email, name, source) VALUES (${sqlEscape(id)}, ${sqlEscape(c.email)}, ${sqlEscape(name)}, 'import');`;
    });
    d1Exec(stmts.join('\n'));
    imported += batch.length;
    process.stdout.write(`\r  ${imported}/${newSubs.length}`);
  }

  console.log(`\n\nImported ${imported} subscribers.`);

  // Final count
  const finalCount = d1Query("SELECT COUNT(*) as cnt FROM newsletter_subscriber WHERE status = 'active'");
  console.log(`Total active subscribers: ${finalCount[0]?.cnt || 0}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
