#!/usr/bin/env node
/**
 * Import Wix Payments CSV into CRM contact table.
 * Enriches existing contacts with course purchase spend.
 * Creates new contacts for emails not yet in CRM.
 *
 * NOTE: Only imports course purchases (Wix Online Programs, Pricing Plans).
 * STUC memberships and donations are already covered by import-wix-orders.mjs.
 *
 * Usage:
 *   node scripts/import-wix-payments.mjs --dry-run
 *   node scripts/import-wix-payments.mjs --execute
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const DRY_RUN = !process.argv.includes('--execute');
const CSV_PATH = process.argv.find(a => a.endsWith('.csv')) || `${process.env.HOME}/Downloads/payments.csv`;
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';

// ── Helpers ────────────────────────────────────────────────────────────
function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`d1Query returned no JSON. Output:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/wix-payments-batch.sql';
  writeFileSync(tmpFile, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile}`, {
      encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

function norm(email) {
  return (email || '').toLowerCase().trim();
}

function parseCSV(text) {
  const lines = text.split('\n');
  // Row 0 = category headers (skip), Row 1 = column headers, Row 2+ = data
  const headers = parseCSVLine(lines[1]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = vals[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Column name mapping (payments.csv has duplicate column names like Email, First Name)
// We use indices directly for the ambiguous columns
function getByIndex(row, headers, index) {
  const key = headers[index];
  // Since headers has duplicates, we need the raw CSV line values
  return row._raw?.[index] || '';
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Wix Payments Import (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}) [DB: ${DB_NAME}] ===\n`);

  // Parse CSV (strip BOM) - payments.csv has a 2-row header
  const csvText = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const lines = csvText.split('\n');
  const headers = parseCSVLine(lines[1]); // Row 1 = actual column headers

  // Parse data rows with raw index access (needed for duplicate column names)
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    rows.push(vals);
  }
  console.log(`Payments CSV: ${rows.length} payment lines from ${CSV_PATH}`);

  // Column indices (from header analysis):
  // 0=Payment Date, 4=Amount, 8=Transaction Status, 9=Payment Type
  // 16=Billing First Name, 17=Billing Last Name, 26=Billing Email, 27=Billing Phone
  // 18=Billing Address, 21=Billing City, 24=Billing State, 25=Billing ZIP, 23=Billing Country
  // 43=Order Type, 45=Product Name
  const COL = {
    DATE: 0, AMOUNT: 4, STATUS: 8, PAYMENT_TYPE: 9,
    FIRST_NAME: 16, LAST_NAME: 17, ADDRESS: 18, CITY: 21,
    COUNTRY: 23, STATE: 24, ZIP: 25, EMAIL: 26, PHONE: 27,
    ORDER_TYPE: 43, PRODUCT: 45,
  };

  // Filter: successful + course purchases only (not STUC/donations)
  const skipEmails = ['virtualassistant@rrmacademy.org', 'tech+virtual@rrmacademy.org'];
  const courseRows = rows.filter(r => {
    if (r[COL.STATUS] !== 'Successful') return false;
    const email = norm(r[COL.EMAIL]);
    if (!email || skipEmails.includes(email)) return false;
    const orderType = r[COL.ORDER_TYPE];
    const product = r[COL.PRODUCT] || '';
    // Course purchases: Wix Online Programs or Pricing Plans, excluding STUC
    if (orderType === 'Wix Online Programs' || orderType === 'Pricing Plans') {
      return !product.includes('Save the Uterus');
    }
    return false;
  });
  console.log(`Course payments (non-STUC): ${courseRows.length} lines`);

  // Aggregate by email
  const byEmail = new Map();
  for (const r of courseRows) {
    const email = norm(r[COL.EMAIL]);
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(r);
  }
  console.log(`Unique course buyers: ${byEmail.size}`);

  // Get existing contacts from D1
  console.log('Fetching existing contacts from D1...');
  const existing = d1Query("SELECT id, email, total_spent FROM contact");
  const contactByEmail = new Map();
  for (const c of existing) {
    contactByEmail.set(norm(c.email), c);
  }
  console.log(`Existing contacts: ${existing.length}`);

  // Build operations
  const updates = [];
  const newContacts = [];
  const newTags = [];

  // Course name -> tag mapping
  const courseTagMap = {
    'Masterclass in Endometriosis and Surgery': 'course:endo-masterclass',
    'Long Term Endometriosis Management': 'course:endo-management',
    'Uterus Super Hero': 'course:uterus-super-hero',
  };

  for (const [email, payments] of byEmail) {
    const courseSpend = payments.reduce((sum, r) => sum + parseFloat(r[COL.AMOUNT] || 0), 0);
    const products = new Set(payments.map(r => r[COL.PRODUCT]));
    const latestPayment = payments[payments.length - 1];
    const firstName = (latestPayment[COL.FIRST_NAME] || '').trim();
    const lastName = (latestPayment[COL.LAST_NAME] || '').trim();

    const existingContact = contactByEmail.get(email);

    if (existingContact) {
      const newTotal = (existingContact.total_spent || 0) + courseSpend;
      updates.push({
        contactId: existingContact.id,
        email,
        currentSpent: existingContact.total_spent || 0,
        courseSpend,
        newTotal,
      });

      // Course tags
      for (const product of products) {
        const tag = courseTagMap[product];
        if (tag) newTags.push({ contactId: existingContact.id, tag, source: 'wix-payments' });
      }
      newTags.push({ contactId: existingContact.id, tag: 'customer', source: 'wix-payments' });
    } else {
      // New contact
      const contactId = randomUUID();
      const firstPaymentDate = payments[0][COL.DATE];

      newContacts.push({
        id: contactId,
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: (latestPayment[COL.PHONE] || '').trim() || null,
        source: 'wix-payments',
        firstSeenAt: firstPaymentDate ? new Date(firstPaymentDate).toISOString() : null,
        totalSpent: courseSpend,
      });

      for (const product of products) {
        const tag = courseTagMap[product];
        if (tag) newTags.push({ contactId, tag, source: 'wix-payments' });
      }
      newTags.push({ contactId, tag: 'customer', source: 'wix-payments' });
    }
  }

  // Report
  console.log(`\n=== OPERATIONS ===`);
  console.log(`Update existing contacts: ${updates.length}`);
  console.log(`New contacts to create:   ${newContacts.length}`);
  console.log(`New tags to add:          ${newTags.length}`);

  console.log(`\n--- Updates (course spend enrichment) ---`);
  for (const u of updates) {
    console.log(`  ${u.email} | was=$${u.currentSpent.toFixed(2)} + course=$${u.courseSpend.toFixed(2)} = $${u.newTotal.toFixed(2)}`);
  }

  console.log(`\n--- New contacts ---`);
  for (const c of newContacts) {
    console.log(`  ${c.email} | ${c.firstName} ${c.lastName} | $${c.totalSpent.toFixed(2)}`);
  }

  console.log(`\n--- Tags (sample) ---`);
  const tagCounts = {};
  for (const t of newTags) tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
  for (const [tag, count] of Object.entries(tagCounts)) {
    console.log(`  ${tag}: ${count}`);
  }

  if (DRY_RUN) {
    console.log(`\n✋ DRY RUN complete. Run with --execute to write to D1.`);
    return;
  }

  // Execute
  console.log(`\n=== WRITING TO D1 ===`);

  // Updates (add course spend to existing total_spent)
  if (updates.length) {
    const stmts = updates.map(u =>
      `UPDATE contact SET total_spent = ${u.newTotal}, updated_at = datetime('now') WHERE id = ${sqlEscape(u.contactId)};`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Updated ${updates.length} contacts (course spend)`);
  }

  // New contacts
  if (newContacts.length) {
    const stmts = newContacts.map(c =>
      `INSERT OR IGNORE INTO contact (id, email, first_name, last_name, phone, source, first_seen_at, total_spent) VALUES (${sqlEscape(c.id)}, ${sqlEscape(c.email)}, ${sqlEscape(c.firstName)}, ${sqlEscape(c.lastName)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.source)}, ${sqlEscape(c.firstSeenAt)}, ${c.totalSpent});`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Inserted ${newContacts.length} new contacts`);
  }

  // Tags
  if (newTags.length) {
    const stmts = newTags.map(t =>
      `INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.contactId)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Inserted ${newTags.length} tags`);
  }

  // Final counts
  const cCount = d1Query("SELECT COUNT(*) as n FROM contact");
  const tCount = d1Query("SELECT COUNT(*) as n FROM contact_tag");
  console.log(`\n=== DONE ===`);
  console.log(`  Contacts:  ${cCount[0]?.n}`);
  console.log(`  Tags:      ${tCount[0]?.n}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
