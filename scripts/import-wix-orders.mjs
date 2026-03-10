#!/usr/bin/env node
/**
 * Import Wix Orders CSV into CRM contact table.
 * Enriches existing contacts with spend, addresses, and tags.
 * Creates new contacts for emails not yet in CRM.
 *
 * Usage:
 *   node scripts/import-wix-orders.mjs --dry-run
 *   node scripts/import-wix-orders.mjs --execute
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const DRY_RUN = !process.argv.includes('--execute');
const CSV_PATH = process.argv.find(a => a.endsWith('.csv')) || `${process.env.HOME}/Downloads/Orders.csv`;

// ── Helpers ────────────────────────────────────────────────────────────
function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute rrm-auth --remote --command '${escaped}'`, {
    encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`d1Query returned no JSON. Output:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/wix-orders-batch.sql';
  writeFileSync(tmpFile, sql);
  try {
    execSync(`npx wrangler d1 execute rrm-auth --remote --file=${tmpFile}`, {
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

function cleanQuotes(val) {
  return (val || '').replace(/^"+|"+$/g, '').trim();
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
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

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Wix Orders Import (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}) ===\n`);

  // Parse CSV (strip BOM)
  const csvText = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(csvText);
  console.log(`Orders CSV: ${rows.length} order lines from ${CSV_PATH}`);

  // Skip test/VA orders
  const skipPatterns = ['virtualassistant', 'tech+virtual', 'russ test'];
  const validRows = rows.filter(r => {
    const email = norm(r['Contact email']);
    const name = (r['Billing name'] || '').toLowerCase();
    return !skipPatterns.some(p => email.includes(p) || name.includes(p));
  });
  console.log(`After filtering test/VA: ${validRows.length} order lines`);

  // Aggregate by email
  const byEmail = new Map();
  for (const r of validRows) {
    const email = norm(r['Contact email']);
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(r);
  }
  console.log(`Unique customer emails: ${byEmail.size}`);

  // Get existing contacts from D1
  console.log('Fetching existing contacts from D1...');
  const existing = d1Query("SELECT id, email, total_spent, total_donated FROM contact");
  const contactByEmail = new Map();
  for (const c of existing) {
    contactByEmail.set(norm(c.email), c);
  }
  console.log(`Existing contacts: ${existing.length}`);

  // Build operations
  const updates = [];    // UPDATE contact SET total_spent, etc.
  const newContacts = []; // INSERT contact
  const newTags = [];    // INSERT contact_tag
  const newAddresses = []; // INSERT contact_address

  for (const [email, orders] of byEmail) {
    orders.sort((a, b) => new Date(a['Date created']) - new Date(b['Date created']));
    const totalSpent = orders.reduce((sum, r) => sum + parseFloat(r['Total'] || 0), 0);
    const orderCount = orders.length;
    const firstOrder = orders[0];
    const latestOrder = orders[orders.length - 1];

    const billingName = cleanQuotes(latestOrder['Billing name']);
    const billingPhone = cleanQuotes(latestOrder['Billing phone']);
    const billingCity = cleanQuotes(latestOrder['Billing city']);
    const billingState = cleanQuotes(latestOrder['Billing state name']);
    const billingAddress = cleanQuotes(latestOrder['Billing address']);
    const billingZip = cleanQuotes(latestOrder['Billing zip/postal code']);
    const billingCountry = cleanQuotes(latestOrder['Billing country']);

    const products = new Set(orders.map(r => r['Item']));
    const isSTUC = products.has('Save the Uterus Club Membership');
    const isDonor = products.has('For true healing and women\'s health');

    const existingContact = contactByEmail.get(email);

    if (existingContact) {
      const newTotal = (existingContact.total_spent || 0) + totalSpent;
      const donationAmount = orders.filter(r => r['Item'].includes('true healing')).reduce((s, r) => s + parseFloat(r['Total'] || 0), 0);
      const newDonated = isDonor ? Math.max(existingContact.total_donated || 0, donationAmount) : existingContact.total_donated;

      updates.push({
        contactId: existingContact.id,
        email,
        totalSpent: newTotal,
        totalDonated: newDonated,
        phone: billingPhone || null,
      });

      // Tags
      if (isSTUC) newTags.push({ contactId: existingContact.id, tag: 'stuc:member', source: 'wix-orders' });
      if (isDonor) newTags.push({ contactId: existingContact.id, tag: 'donor', source: 'wix-orders' });
      newTags.push({ contactId: existingContact.id, tag: 'customer', source: 'wix-orders' });

      // Billing address
      if (billingAddress) {
        newAddresses.push({
          id: randomUUID(),
          contactId: existingContact.id,
          type: 'billing',
          line1: billingAddress,
          city: billingCity,
          state: billingState,
          zip: billingZip,
          country: billingCountry,
        });
      }
    } else {
      // New contact
      const nameParts = billingName.split(/\s+/);
      const contactId = randomUUID();

      newContacts.push({
        id: contactId,
        email,
        firstName: nameParts[0] || null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        phone: billingPhone || null,
        source: 'wix-orders',
        firstSeenAt: new Date(firstOrder['Date created']).toISOString(),
        totalSpent,
        totalDonated: isDonor ? orders.filter(r => r['Item'].includes('true healing')).reduce((s, r) => s + parseFloat(r['Total'] || 0), 0) : 0,
      });

      if (isSTUC) newTags.push({ contactId, tag: 'stuc:member', source: 'wix-orders' });
      if (isDonor) newTags.push({ contactId, tag: 'donor', source: 'wix-orders' });
      newTags.push({ contactId, tag: 'customer', source: 'wix-orders' });

      if (billingAddress) {
        newAddresses.push({
          id: randomUUID(),
          contactId,
          type: 'billing',
          line1: billingAddress,
          city: billingCity,
          state: billingState,
          zip: billingZip,
          country: billingCountry,
        });
      }
    }
  }

  // Report
  console.log(`\n=== OPERATIONS ===`);
  console.log(`Update existing contacts: ${updates.length}`);
  console.log(`New contacts to create:   ${newContacts.length}`);
  console.log(`New tags to add:          ${newTags.length}`);
  console.log(`New addresses to add:     ${newAddresses.length}`);

  console.log(`\n--- Updates (spend enrichment) ---`);
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.email} | total_spent=${u.totalSpent.toFixed(2)} | total_donated=${u.totalDonated != null ? u.totalDonated.toFixed(2) : 'NULL'}`);
  }
  if (updates.length > 10) console.log(`  ... and ${updates.length - 10} more`);

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

  // Updates
  if (updates.length) {
    const stmts = updates.map(u =>
      `UPDATE contact SET total_spent = ${u.totalSpent}${u.totalDonated != null ? `, total_donated = ${u.totalDonated}` : ''}${u.phone ? `, phone = ${sqlEscape(u.phone)}` : ''}, updated_at = datetime('now') WHERE id = ${sqlEscape(u.contactId)};`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Updated ${updates.length} contacts (spend + phone)`);
  }

  // New contacts
  if (newContacts.length) {
    const stmts = newContacts.map(c =>
      `INSERT OR IGNORE INTO contact (id, email, first_name, last_name, phone, source, first_seen_at, total_spent, total_donated) VALUES (${sqlEscape(c.id)}, ${sqlEscape(c.email)}, ${sqlEscape(c.firstName)}, ${sqlEscape(c.lastName)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.source)}, ${sqlEscape(c.firstSeenAt)}, ${c.totalSpent}, ${c.totalDonated});`
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

  // Addresses
  if (newAddresses.length) {
    const stmts = newAddresses.map(a =>
      `INSERT OR IGNORE INTO contact_address (id, contact_id, type, line1, city, state, zip, country) VALUES (${sqlEscape(a.id)}, ${sqlEscape(a.contactId)}, ${sqlEscape(a.type)}, ${sqlEscape(a.line1)}, ${sqlEscape(a.city)}, ${sqlEscape(a.state)}, ${sqlEscape(a.zip)}, ${sqlEscape(a.country)});`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Inserted ${newAddresses.length} addresses`);
  }

  // Final counts
  const cCount = d1Query("SELECT COUNT(*) as n FROM contact");
  const tCount = d1Query("SELECT COUNT(*) as n FROM contact_tag");
  const aCount = d1Query("SELECT COUNT(*) as n FROM contact_address");
  console.log(`\n=== DONE ===`);
  console.log(`  Contacts:  ${cCount[0]?.n}`);
  console.log(`  Tags:      ${tCount[0]?.n}`);
  console.log(`  Addresses: ${aCount[0]?.n}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
