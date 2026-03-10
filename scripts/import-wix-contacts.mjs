#!/usr/bin/env node
/**
 * Import Wix Contacts CSV into CRM contact table.
 * Enriches existing contacts with subscriber status, labels, names, dates.
 * Creates new contacts for emails not yet in CRM.
 *
 * Usage:
 *   node scripts/import-wix-contacts.mjs --dry-run
 *   node scripts/import-wix-contacts.mjs --execute
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const DRY_RUN = !process.argv.includes('--execute');
const CSV_PATH = process.argv.find(a => a.endsWith('.csv')) || `${process.env.HOME}/Downloads/contacts.csv`;
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
  const tmpFile = '/tmp/wix-contacts-batch.sql';
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

// Wix label -> CRM tag mapping (explicit, no inference)
const LABEL_TAG_MAP = {
  'EndoSelfSurvey 📋': 'survey:endo-self-survey',
  'SQSP ◼️': 'platform:squarespace',
  'RRM Academy Members Group member': null, // pass-through as-is
  'Research Sub 🧪': null,
  'Masterclass in Endometriosis & Surgery': 'course:endo-surgery-masterclass',
  'Masterclass in Endometriosis and Surgery': 'course:endo-surgery-masterclass',
  'Spam 🛑': null, // filter, don't tag
  'DO NOT SEND LIST 🛑': null, // filter, don't tag
  'Donor 👏': 'donor',
  'Customers': 'customer',
  'Save the Uterus Club 🏷️': 'stuc:member',
  'Save the Uterus Club Group member': 'stuc:member',
  'Save the Uterus Club Membership': 'stuc:member',
  'Uterus Member 🐻': 'stuc:member',
  'Uterus Hero 💖': 'stuc:hero',
  'Uterus Super Hero 🦸‍♀️': 'stuc:superhero',
  'Pre-SQSP 🪨': 'platform:pre-squarespace',
  'Contacted Me': null,
  'Masterclass Members Group member': null,
  'Long Term Endometriosis Management': 'course:long-term-endo-mgmt',
  'Endo Surgeon Workbook 🏷️': 'download:endo-surgeon-workbook',
  'Postpartum Depression & Anxiety: a restorative approach to recovery': 'course:ppd-restorative',
  'Circle of Impact 📥': 'donor:circle-of-impact',
  'Endo Pain Mgmt 🧑‍🎓': 'course:endo-pain-mgmt',
  'AALFA Group 🧑‍🎓': 'course:aalfa',
  'Blog Sub 🤓': 'subscriber:blog',
  'PCOS Masterclass Members Group member': 'course:pcos-masterclass',
  'Volunteer 🪁': 'volunteer',
  'Guest Writer ✍️': 'contributor',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'course:rrm-vs-art',
};

const SKIP_LABELS = new Set(['Spam 🛑', 'DO NOT SEND LIST 🛑']);

// Wix source -> CRM source
const SOURCE_MAP = {
  'Site Members': 'wix-site',
  'Contact Import': 'import',
  'Form Submission': 'form',
  'Wix Stores': 'wix-store',
  'External App': 'external',
  'Manual Creation': 'manual',
};

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Wix Contacts Import (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}) [DB: ${DB_NAME}] ===\n`);

  const csvText = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(csvText);
  console.log(`CSV: ${rows.length} rows from ${CSV_PATH}`);

  // Dedup by email (merge labels across duplicate rows)
  const byEmail = new Map();
  for (const r of rows) {
    const email = norm(r['Email 1']);
    if (!email) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, r);
    } else {
      const existing = byEmail.get(email);
      const existingLabels = (existing.Labels || '').split(';').map(l => l.trim()).filter(Boolean);
      const newLabels = (r.Labels || '').split(';').map(l => l.trim()).filter(Boolean);
      const merged = new Set([...existingLabels, ...newLabels]);
      existing.Labels = [...merged].join(';');
    }
  }
  console.log(`Unique emails: ${byEmail.size}`);

  // Filter spam/do-not-send
  let spamCount = 0;
  for (const [email, r] of byEmail) {
    const labels = (r.Labels || '').split(';').map(l => l.trim()).filter(Boolean);
    if (labels.some(l => SKIP_LABELS.has(l))) {
      byEmail.delete(email);
      spamCount++;
    }
  }
  // Filter test emails
  let testCount = 0;
  for (const email of byEmail.keys()) {
    const local = email.split('@')[0];
    const domain = email.split('@')[1] || '';
    if (domain === 'example.com' || domain === 'example.org' || domain === 'test.com' ||
        local === 'test' || local.endsWith('+test') || /^test\d+$/.test(local) ||
        email.includes('virtualassistant')) {
      byEmail.delete(email);
      testCount++;
    }
  }
  console.log(`Filtered: ${spamCount} spam, ${testCount} test. Remaining: ${byEmail.size}`);

  // Load existing CRM contacts
  console.log('Fetching existing CRM contacts...');
  const existing = d1Query("SELECT id, email, first_name, last_name, source, first_seen_at, accepts_marketing FROM contact");
  const crmByEmail = new Map();
  for (const c of existing) crmByEmail.set(norm(c.email), c);
  console.log(`Existing CRM contacts: ${crmByEmail.size}`);

  // Load existing tags
  const existingTags = d1Query("SELECT contact_id, tag FROM contact_tag");
  const tagSet = new Set(existingTags.map(t => `${t.contact_id}::${t.tag}`));

  // Build operations
  const updates = [];       // UPDATE contact
  const newContacts = [];    // INSERT contact
  const newTags = [];        // INSERT contact_tag
  const newAddresses = [];   // INSERT contact_address

  for (const [email, r] of byEmail) {
    const firstName = (r['First Name'] || '').trim() || null;
    const lastName = (r['Last Name'] || '').trim() || null;
    const phone = (r['Phone 1'] || '').trim() || null;
    const igHandle = (r['IG Handle (import)'] || '').trim() || null;
    const createdAt = r['Created At (UTC+0)'] ? new Date(r['Created At (UTC+0)']).toISOString() : null;
    const subscriberStatus = (r['Email subscriber status'] || '').trim();
    const wixSource = (r['Source'] || '').trim();
    const source = SOURCE_MAP[wixSource] || wixSource || null;
    const labels = (r['Labels'] || '').split(';').map(l => l.trim()).filter(Boolean);
    const acceptsMarketing = subscriberStatus === 'Subscribed' ? 1 : 0;
    const totalSpent = parseFloat(r['Total Spent (Import)'] || 0);
    const totalDonated = parseFloat(r['Total Donation Amount (import)'] || 0);

    // Address
    const addr1Street = (r['Address 1 - Street'] || '').trim();
    const addr1City = (r['Address 1 - City'] || '').trim();
    const addr1State = (r['Address 1 - State/Region'] || '').trim();
    const addr1Zip = (r['Address 1 - Zip'] || '').trim();
    const addr1Country = (r['Address 1 - Country'] || '').trim();
    const addr1Type = (r['Address 1 - Type'] || 'home').trim();

    const existingContact = crmByEmail.get(email);

    if (existingContact) {
      // Enrich existing contact
      const update = { contactId: existingContact.id, email };
      const changes = [];

      // Fill in missing names
      if (!existingContact.first_name && firstName) {
        changes.push(`first_name = ${sqlEscape(firstName)}`);
      }
      if (!existingContact.last_name && lastName) {
        changes.push(`last_name = ${sqlEscape(lastName)}`);
      }

      // Update accepts_marketing if Wix says subscribed
      if (acceptsMarketing && !existingContact.accepts_marketing) {
        changes.push(`accepts_marketing = 1`);
      }

      // Update first_seen_at if Wix date is earlier
      if (createdAt && existingContact.first_seen_at && new Date(createdAt) < new Date(existingContact.first_seen_at)) {
        changes.push(`first_seen_at = ${sqlEscape(createdAt)}`);
      } else if (createdAt && !existingContact.first_seen_at) {
        changes.push(`first_seen_at = ${sqlEscape(createdAt)}`);
      }

      // Update source if missing
      if (!existingContact.source && source) {
        changes.push(`source = ${sqlEscape(source)}`);
      }

      // Enrich spend (use MAX since same Wix source)
      if (totalSpent > 0) {
        changes.push(`total_spent = MAX(COALESCE(total_spent, 0), ${totalSpent})`);
      }
      if (totalDonated > 0) {
        changes.push(`total_donated = MAX(COALESCE(total_donated, 0), ${totalDonated})`);
      }

      if (changes.length) {
        changes.push("updated_at = datetime('now')");
        update.sql = `UPDATE contact SET ${changes.join(', ')} WHERE id = ${sqlEscape(existingContact.id)};`;
        updates.push(update);
      }

      // Tags from labels
      for (const label of labels) {
        if (SKIP_LABELS.has(label)) continue;

        // Always add the raw Wix label
        const rawKey = `${existingContact.id}::${label}`;
        if (!tagSet.has(rawKey)) {
          newTags.push({ contactId: existingContact.id, tag: label, source: 'wix-contacts' });
          tagSet.add(rawKey);
        }

        // Add mapped clean tag if different
        const mapped = LABEL_TAG_MAP[label];
        if (mapped && mapped !== label) {
          const mappedKey = `${existingContact.id}::${mapped}`;
          if (!tagSet.has(mappedKey)) {
            newTags.push({ contactId: existingContact.id, tag: mapped, source: 'wix-contacts' });
            tagSet.add(mappedKey);
          }
          if (mapped.startsWith('donor:')) {
            const donorKey = `${existingContact.id}::donor`;
            if (!tagSet.has(donorKey)) {
              newTags.push({ contactId: existingContact.id, tag: 'donor', source: 'wix-contacts' });
              tagSet.add(donorKey);
            }
          }
        }
      }

      // Subscriber status tag
      if (subscriberStatus === 'Subscribed') {
        const subKey = `${existingContact.id}::wix:subscribed`;
        if (!tagSet.has(subKey)) {
          newTags.push({ contactId: existingContact.id, tag: 'wix:subscribed', source: 'wix-contacts' });
          tagSet.add(subKey);
        }
      } else if (subscriberStatus === 'Unsubscribed') {
        const unsubKey = `${existingContact.id}::wix:unsubscribed`;
        if (!tagSet.has(unsubKey)) {
          newTags.push({ contactId: existingContact.id, tag: 'wix:unsubscribed', source: 'wix-contacts' });
          tagSet.add(unsubKey);
        }
      }

      // Address
      if (addr1Street) {
        newAddresses.push({
          id: randomUUID(), contactId: existingContact.id, type: addr1Type,
          line1: addr1Street, city: addr1City, state: addr1State,
          zip: addr1Zip, country: addr1Country,
        });
      }

    } else {
      // New contact
      const contactId = randomUUID();

      newContacts.push({
        id: contactId,
        email,
        firstName,
        lastName,
        phone,
        igHandle,
        source,
        firstSeenAt: createdAt,
        totalSpent,
        totalDonated,
        acceptsMarketing,
      });

      // Tags
      for (const label of labels) {
        if (SKIP_LABELS.has(label)) continue;
        newTags.push({ contactId, tag: label, source: 'wix-contacts' });
        const mapped = LABEL_TAG_MAP[label];
        if (mapped && mapped !== label) {
          newTags.push({ contactId, tag: mapped, source: 'wix-contacts' });
          if (mapped.startsWith('donor:')) {
            newTags.push({ contactId, tag: 'donor', source: 'wix-contacts' });
          }
        }
      }

      if (subscriberStatus === 'Subscribed') {
        newTags.push({ contactId, tag: 'wix:subscribed', source: 'wix-contacts' });
      } else if (subscriberStatus === 'Unsubscribed') {
        newTags.push({ contactId, tag: 'wix:unsubscribed', source: 'wix-contacts' });
      }

      // Address
      if (addr1Street) {
        newAddresses.push({
          id: randomUUID(), contactId, type: addr1Type,
          line1: addr1Street, city: addr1City, state: addr1State,
          zip: addr1Zip, country: addr1Country,
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

  // Tag distribution
  const tagCounts = {};
  for (const t of newTags) tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\n--- New tags (top 20) ---`);
  for (const [tag, count] of sortedTags.slice(0, 20)) {
    console.log(`  ${tag}: ${count}`);
  }

  // New contact subscriber status
  const newSubbed = newContacts.filter(c => c.acceptsMarketing).length;
  const newNotSubbed = newContacts.length - newSubbed;
  console.log(`\n--- New contacts subscriber status ---`);
  console.log(`  Subscribed: ${newSubbed}`);
  console.log(`  Not subscribed: ${newNotSubbed}`);

  // Sample new contacts
  console.log(`\n--- Sample new contacts (10) ---`);
  for (const c of newContacts.slice(0, 10)) {
    console.log(`  ${c.email} | ${c.firstName || ''} ${c.lastName || ''} | src: ${c.source} | seen: ${c.firstSeenAt?.slice(0,10) || '?'} | marketing: ${c.acceptsMarketing ? 'yes' : 'no'}`);
  }

  if (DRY_RUN) {
    console.log(`\n✋ DRY RUN complete. Run with --execute to write to D1.`);
    return;
  }

  // Execute
  console.log(`\n=== WRITING TO D1 ===`);
  const BATCH = 50;

  // Updates
  if (updates.length) {
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      d1Exec(batch.map(u => u.sql).join('\n'));
      process.stdout.write(`\r  Updates: ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
    }
    console.log();
  }

  // New contacts
  if (newContacts.length) {
    for (let i = 0; i < newContacts.length; i += BATCH) {
      const batch = newContacts.slice(i, i + BATCH);
      const stmts = batch.map(c =>
        `INSERT OR IGNORE INTO contact (id, email, first_name, last_name, phone, ig_handle, source, first_seen_at, total_spent, total_donated, accepts_marketing) VALUES (${sqlEscape(c.id)}, ${sqlEscape(c.email)}, ${sqlEscape(c.firstName)}, ${sqlEscape(c.lastName)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.igHandle)}, ${sqlEscape(c.source)}, ${sqlEscape(c.firstSeenAt)}, ${c.totalSpent}, ${c.totalDonated}, ${c.acceptsMarketing});`
      );
      d1Exec(stmts.join('\n'));
      process.stdout.write(`\r  New contacts: ${Math.min(i + BATCH, newContacts.length)}/${newContacts.length}`);
    }
    console.log();
  }

  // Tags
  if (newTags.length) {
    for (let i = 0; i < newTags.length; i += BATCH * 2) {
      const batch = newTags.slice(i, i + BATCH * 2);
      const stmts = batch.map(t =>
        `INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.contactId)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`
      );
      d1Exec(stmts.join('\n'));
      process.stdout.write(`\r  Tags: ${Math.min(i + BATCH * 2, newTags.length)}/${newTags.length}`);
    }
    console.log();
  }

  // Addresses
  if (newAddresses.length) {
    const stmts = newAddresses.map(a =>
      `INSERT OR IGNORE INTO contact_address (id, contact_id, type, line1, city, state, zip, country) VALUES (${sqlEscape(a.id)}, ${sqlEscape(a.contactId)}, ${sqlEscape(a.type)}, ${sqlEscape(a.line1)}, ${sqlEscape(a.city)}, ${sqlEscape(a.state)}, ${sqlEscape(a.zip)}, ${sqlEscape(a.country)});`
    );
    d1Exec(stmts.join('\n'));
    console.log(`  Addresses: ${newAddresses.length}`);
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
