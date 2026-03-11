#!/usr/bin/env node
/**
 * Populate newsletter_subscriber.segments from CRM contact_tag + enrollment data.
 *
 * Maps CRM tags to clean segment names. Segments are stored as JSON arrays
 * in the newsletter_subscriber.segments column, used by send.js for targeting.
 *
 * Usage:
 *   node scripts/segment-newsletter.mjs            # apply segments
 *   node scripts/segment-newsletter.mjs --dry-run  # report only
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const DRY_RUN = process.argv.includes('--dry-run');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';
const CWD = process.env.HOME + '/iCode/projects/rrm-academy-cf';

// CRM tag -> newsletter segment name
const TAG_TO_SEGMENT = {
  'survey:endo-self-survey': 'endo-survey',
  'EndoSelfSurvey 📋': 'endo-survey',
  'endo-survey': 'endo-survey',
  'lead:survey': 'endo-survey',
  'wix:subscribed': 'marketing-opted-in',
  'accepts-marketing': 'marketing-opted-in',
  'RRM Academy Members Group member': 'member',
  'lead:course': 'course-interest',
  'customer': 'customer',
  'Customers': 'customer',
  'course:endo-surgery-masterclass': 'course-endo-masterclass',
  'Masterclass in Endometriosis & Surgery': 'course-endo-masterclass',
  'Research Sub 🧪': 'research-subscriber',
  'download:endo-surgeon-workbook': 'download-workbook',
  'Endo Surgeon Workbook 🏷️': 'download-workbook',
  'stuc:member': 'stuc',
  'Save the Uterus Club 🏷️': 'stuc',
  'Uterus Member 🐻': 'stuc',
  'donor': 'donor',
  'Donor 👏': 'donor',
  'course:rrm-vs-art': 'course-rrm-vs-art',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'course-rrm-vs-art',
  'platform:squarespace': 'legacy-squarespace',
  'SQSP ◼️': 'legacy-squarespace',
  'source:biosite': 'biosite-lead',
};

function d1Query(sql) {
  // Write SQL to file, execute with --command reading from env to avoid shell quoting
  const clean = sql.replace(/\s+/g, ' ').trim();
  const escaped = clean.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8', cwd: CWD, maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) return [];
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const f = '/tmp/segment-batch.sql';
  writeFileSync(f, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file=${f}`, {
      encoding: 'utf8', cwd: CWD, maxBuffer: 50 * 1024 * 1024,
    });
  } finally { try { unlinkSync(f); } catch {} }
}

function esc(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

async function main() {
  console.log(`\n=== Newsletter Segmentation [DB: ${DB_NAME}] ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Get all contact tags for newsletter subscribers
  // Note: avoid single quotes in --command SQL; use double quotes where possible
  const tagRows = d1Query(
    "SELECT ns.id as sub_id, ns.email, ct.tag FROM newsletter_subscriber ns JOIN contact c ON LOWER(c.email) = LOWER(ns.email) JOIN contact_tag ct ON ct.contact_id = c.id WHERE ct.tag NOT LIKE 'elv:%' AND ct.tag != 'email:valid'"
  );
  console.log(`Contact tag rows: ${tagRows.length}`);

  // Build segments per subscriber
  const subSegments = new Map();
  for (const r of tagRows) {
    const seg = TAG_TO_SEGMENT[r.tag];
    if (!seg) continue;
    if (!subSegments.has(r.sub_id)) subSegments.set(r.sub_id, new Set());
    subSegments.get(r.sub_id).add(seg);
  }

  // Check enrollment table
  const enrolled = d1Query(`
    SELECT ns.id as sub_id
    FROM newsletter_subscriber ns
    JOIN user u ON LOWER(u.email) = LOWER(ns.email)
    JOIN enrollment e ON e.user_id = u.id
    GROUP BY ns.id
  `);
  for (const r of enrolled) {
    if (!subSegments.has(r.sub_id)) subSegments.set(r.sub_id, new Set());
    subSegments.get(r.sub_id).add('enrolled');
  }

  // Check Stripe customers (donors/purchasers)
  const stripe = d1Query(`
    SELECT ns.id as sub_id
    FROM newsletter_subscriber ns
    JOIN user u ON LOWER(u.email) = LOWER(ns.email)
    WHERE u.stripe_customer_id IS NOT NULL
    GROUP BY ns.id
  `);
  for (const r of stripe) {
    if (!subSegments.has(r.sub_id)) subSegments.set(r.sub_id, new Set());
    subSegments.get(r.sub_id).add('stripe-customer');
  }

  console.log(`Subscribers with segments: ${subSegments.size}`);

  // Tally
  const segCounts = {};
  for (const [, segs] of subSegments) {
    for (const s of segs) {
      segCounts[s] = (segCounts[s] || 0) + 1;
    }
  }
  console.log('\nSegment distribution:');
  for (const [s, c] of Object.entries(segCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(25)} ${c}`);
  }

  const totalSubs = d1Query("SELECT COUNT(*) as cnt FROM newsletter_subscriber");
  const unsegmented = (totalSubs[0]?.cnt || 0) - subSegments.size;
  console.log(`\n  (unsegmented)           ${unsegmented}`);
  console.log(`  Total subscribers:      ${totalSubs[0]?.cnt || 0}`);

  if (DRY_RUN) {
    console.log('\nDry run -- no changes made.');
    return;
  }

  // Build update statements
  const updates = [];
  for (const [subId, segs] of subSegments) {
    const json = JSON.stringify([...segs].sort());
    updates.push(`UPDATE newsletter_subscriber SET segments = ${esc(json)} WHERE id = ${esc(subId)};`);
  }

  console.log(`\nUpdating ${updates.length} subscribers...`);

  const BATCH = 50;
  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    d1Exec(batch.join('\n'));
    done += batch.length;
    process.stdout.write(`\r  ${done}/${updates.length}`);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
