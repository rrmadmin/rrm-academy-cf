#!/usr/bin/env node
/**
 * Build Contact CRM: merges 4 historical sources into D1 contact table.
 *
 * Usage:
 *   node scripts/build-contact-crm.mjs --dry-run     # preview only
 *   node scripts/build-contact-crm.mjs --execute      # write to D1
 *
 * Reads transformation rules from scripts/contact-enrichment-spec.json.
 * All inserts are INSERT OR IGNORE (idempotent, safe to re-run).
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const DRY_RUN = !process.argv.includes('--execute');
const VERBOSE = process.argv.includes('--verbose');

// ── Load spec ──────────────────────────────────────────────────────────
const spec = JSON.parse(readFileSync(new URL('./contact-enrichment-spec.json', import.meta.url), 'utf8'));

// ── Helpers ────────────────────────────────────────────────────────────
function getAirtablePAT() {
  return execSync("op read 'op://Automation/OpenClaw Airtable PAT/credential'", { encoding: 'utf8' }).trim();
}

async function fetchAllAirtable(pat, baseId, tableId) {
  const records = [];
  let offset = null;
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${pat}` } });
    if (!resp.ok) throw new Error(`Airtable ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute rrm-auth --remote --command '${escaped}'`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) return [];
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results || [];
}

function d1Exec(sql) {
  // Write SQL to temp file to avoid shell escaping issues
  const tmpFile = '/tmp/crm-batch.sql';
  writeFileSync(tmpFile, sql);
  execSync(`npx wrangler d1 execute rrm-auth --remote --file=${tmpFile}`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function norm(email) {
  return (email || '').toLowerCase().trim();
}

function earliest(...dates) {
  const valid = dates.filter(Boolean).map(d => {
    // Handle text dates like "August 28, 2023"
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }).filter(Boolean);
  if (!valid.length) return null;
  return valid.sort()[0];
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

// ── Tag mapping from spec ──────────────────────────────────────────────
const TAG_MAP = {
  master_stage: spec.tag_mapping.from_airtable_master_stage,
  master_tags_clean: spec.tag_mapping.from_airtable_master_tags_clean,
  master_tags_orig: spec.tag_mapping.from_airtable_master_tags_orig,
  master_web_host: spec.tag_mapping.from_airtable_master_web_host,
  sqsp_member_areas: spec.tag_mapping.from_airtable_sqsp_member_areas,
  sqsp_tags: spec.tag_mapping.from_airtable_sqsp_tags,
};

function mapTags(rawValues, mapping) {
  const tags = [];
  for (const val of rawValues) {
    const cleaned = val.trim();
    if (cleaned in mapping && mapping[cleaned] !== null) {
      tags.push(mapping[cleaned]);
    }
  }
  return tags;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Contact CRM Builder (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}) ===\n`);

  // 1. Fetch all sources
  console.log('Fetching sources...');
  const pat = getAirtablePAT();

  const [atMaster, atSQSP, at3Tier] = await Promise.all([
    fetchAllAirtable(pat, 'appGBJYrGIOvnyEWY', 'tblm2xnH2IoJxDooc'),
    fetchAllAirtable(pat, 'appGBJYrGIOvnyEWY', 'tblPrwxFnVbcVOd9e'),
    fetchAllAirtable(pat, 'appGBJYrGIOvnyEWY', 'tbl4mSRrAuBBiGWT4'),
  ]);

  console.log(`  Airtable Master:  ${atMaster.length} records`);
  console.log(`  SQSP Profiles:    ${atSQSP.length} records`);
  console.log(`  3 Tier Downloads: ${at3Tier.length} records`);

  console.log('Fetching D1 users...');
  const d1Users = d1Query("SELECT id, email, name, first_name, last_name, created_at, stripe_customer_id, blocked, email_verified FROM user");
  const d1Labels = d1Query("SELECT user_id, label FROM user_label");
  console.log(`  D1 Users:  ${d1Users.length} records`);
  console.log(`  D1 Labels: ${d1Labels.length} records`);

  // 2. Index sources by email
  // D1 users
  const d1ByEmail = new Map();
  for (const u of d1Users) {
    d1ByEmail.set(norm(u.email), u);
  }

  // D1 labels by user_id
  const labelsByUserId = new Map();
  for (const l of d1Labels) {
    if (!labelsByUserId.has(l.user_id)) labelsByUserId.set(l.user_id, []);
    labelsByUserId.get(l.user_id).push(l.label);
  }

  // Airtable Master by email
  const masterByEmail = new Map();
  for (const r of atMaster) {
    const e = norm(r.fields['Email Address']);
    if (e) masterByEmail.set(e, r.fields);
  }

  // SQSP by email
  const sqspByEmail = new Map();
  for (const r of atSQSP) {
    const e = norm(r.fields.Email || r.fields['Email Original'] || '');
    if (e) sqspByEmail.set(e, r.fields);
  }

  // 3 Tier by email (earliest date per email)
  const tierByEmail = new Map();
  for (const r of at3Tier) {
    const e = norm(r.fields['Email Address'] || '');
    const date = r.fields['Submitted On'] || '';
    const name = r.fields.Name || '';
    if (!e) continue;
    const existing = tierByEmail.get(e);
    if (!existing || date < existing.date) {
      tierByEmail.set(e, { date, name, landingPage: r.fields['Landing Page'] || '' });
    }
  }

  // 3. Collect all unique emails
  const allEmails = new Set([
    ...d1ByEmail.keys(),
    ...masterByEmail.keys(),
    ...sqspByEmail.keys(),
    ...tierByEmail.keys(),
  ]);

  // 4. Build unified contact records
  const contacts = [];
  const contactTags = []; // { contactId, tag, source }
  const contactAddresses = []; // { id, contactId, type, ... }

  const spamLabels = new Set(['Spam 🛑', 'DO NOT SEND LIST 🛑']);
  let skipped = { test: 0, spam: 0, blocked: 0, unverified_only: 0 };

  for (const email of allEmails) {
    // Filter: test/example emails
    if (email.includes('test') || email.includes('example')) {
      skipped.test++;
      continue;
    }

    const d1 = d1ByEmail.get(email);
    const master = masterByEmail.get(email);
    const sqsp = sqspByEmail.get(email);
    const tier = tierByEmail.get(email);

    // Filter: blocked D1 users
    if (d1 && d1.blocked === 1) {
      skipped.blocked++;
      continue;
    }

    // Filter: D1-only users who are unverified
    if (d1 && !master && !sqsp && !tier && d1.email_verified === 0) {
      skipped.unverified_only++;
      continue;
    }

    // Filter: spam-flagged
    if (master && master.Check === '🚩') {
      skipped.spam++;
      continue;
    }
    if (d1) {
      const labels = labelsByUserId.get(d1.id) || [];
      if (labels.some(l => spamLabels.has(l))) {
        skipped.spam++;
        continue;
      }
    }

    const contactId = d1 ? d1.id : randomUUID();
    const tags = new Set();
    const tagSources = new Map(); // tag -> source

    function addTag(tag, src) {
      if (tag && !tags.has(tag)) {
        tags.add(tag);
        tagSources.set(tag, src);
      }
    }

    // ── Merge fields (priority: D1 > Master > SQSP > 3Tier) ──

    // Parse 3 Tier name
    let tierFirstName = null, tierLastName = null;
    if (tier?.name) {
      const parts = tier.name.trim().split(/\s+/);
      tierFirstName = parts[0] || null;
      tierLastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }

    const firstName = d1?.first_name || master?.['First Name'] || sqsp?.['First Name'] || tierFirstName || null;
    const lastName = d1?.last_name || master?.['Last Name'] || sqsp?.['Last Name'] || tierLastName || null;
    const phone = master?.['Phone Number'] || null;
    const igHandle = master?.['IG Handle'] || null;
    const region = master?.REGION || null;

    // Source
    const source = master?.Source || master?.['Source copy'] || null;

    // Landing page
    const landingPage = master?.['Landing Page'] || tier?.landingPage || null;

    // First seen (earliest date from any source)
    const firstSeenAt = earliest(
      d1?.created_at,
      master?.OPTIN_TIME,
      sqsp?.['Subscriber Since'],
      sqsp?.['Customer Since'],
      tier?.date,
    );

    // Spend
    const totalSpent = Math.max(master?.['Total Spent'] || 0, sqsp?.['Total Spent'] || 0);
    const totalDonated = sqsp?.['Total Donation Amount'] || 0;

    // Marketing consent
    const acceptsMarketing = sqsp?.['Accepts Marketing'] ? 1 : 0;

    // Notes
    const notes = master?.NOTES || null;

    // User linkage
    const userId = d1?.id || null;
    const stripeCustomerId = d1?.stripe_customer_id || null;

    // ── Tags ──

    // D1 user_labels (pass-through)
    if (d1) {
      const labels = labelsByUserId.get(d1.id) || [];
      for (const l of labels) {
        if (!spamLabels.has(l)) addTag(l, 'd1-label');
      }
    }

    // Airtable Master tags
    if (master) {
      for (const s of master.Stage || []) {
        const mapped = TAG_MAP.master_stage[s];
        if (mapped) addTag(mapped, 'airtable-master');
      }
      for (const t of master.Tags || []) {
        const mapped = TAG_MAP.master_tags_clean[t];
        if (mapped) addTag(mapped, 'airtable-master');
      }
      for (const t of master['TAGS orig'] || []) {
        const cleaned = t.trim();
        const mapped = TAG_MAP.master_tags_orig[cleaned];
        if (mapped) addTag(mapped, 'airtable-master');
      }
      for (const w of master['Web Host'] || []) {
        const mapped = TAG_MAP.master_web_host[w];
        if (mapped) addTag(mapped, 'airtable-master');
      }
      if (master['Total Spent'] > 0) addTag('customer', 'airtable-master');
    }

    // SQSP tags
    if (sqsp) {
      // Member Areas is a singleSelect, could be comma-separated in the value
      const memberArea = sqsp['Member Areas'] || '';
      if (memberArea) {
        // Try exact match first
        const mapped = TAG_MAP.sqsp_member_areas[memberArea];
        if (mapped) {
          addTag(mapped, 'airtable-sqsp');
        } else {
          // Try each known key as substring
          for (const [key, val] of Object.entries(TAG_MAP.sqsp_member_areas)) {
            if (memberArea.includes(key) && val) addTag(val, 'airtable-sqsp');
          }
        }
      }

      const sqspTag = (sqsp.Tags || '').trim();
      if (sqspTag && TAG_MAP.sqsp_tags[sqspTag]) {
        addTag(TAG_MAP.sqsp_tags[sqspTag], 'airtable-sqsp');
      }

      if (sqsp['Total Spent'] > 0) addTag('customer', 'airtable-sqsp');
      if (sqsp['Total Donation Amount'] > 0) addTag('donor', 'airtable-sqsp');
      if (sqsp['Accepts Marketing']) addTag('accepts-marketing', 'airtable-sqsp');
    }

    // 3 Tier
    if (tier) {
      addTag('survey:endo-self-survey', 'airtable-3tier');
    }

    // Derived: donor from D1 labels
    if (d1) {
      const labels = labelsByUserId.get(d1.id) || [];
      if (labels.includes('Donor 👏') || labels.includes('Circle of Impact 📥')) {
        addTag('donor', 'd1-label');
      }
    }

    contacts.push({
      id: contactId,
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      ig_handle: igHandle,
      region,
      source,
      landing_page: landingPage,
      first_seen_at: firstSeenAt,
      total_spent: totalSpent,
      total_donated: totalDonated,
      accepts_marketing: acceptsMarketing,
      notes,
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
    });

    for (const tag of tags) {
      contactTags.push({ contactId, tag, source: tagSources.get(tag) });
    }

    // Addresses from SQSP
    if (sqsp) {
      if (sqsp['Shipping Address 1']) {
        contactAddresses.push({
          id: randomUUID(),
          contactId,
          type: 'shipping',
          line1: sqsp['Shipping Address 1'] || null,
          line2: sqsp['Shipping Address 2'] || null,
          city: sqsp['Shipping City'] || null,
          state: sqsp['Shipping Province/State'] || null,
          zip: sqsp['Shipping Zip'] || null,
          country: sqsp['Shipping Country'] || null,
        });
      }
      if (sqsp['Billing Address 1']) {
        contactAddresses.push({
          id: randomUUID(),
          contactId,
          type: 'billing',
          line1: sqsp['Billing Address 1'] || null,
          line2: sqsp['Billing Address 2'] || null,
          city: sqsp['Billing City'] || null,
          state: sqsp['Billing Province/State'] || null,
          zip: String(sqsp['Billing Zip'] || '') || null,
          country: sqsp['Billing Country'] || null,
        });
      }
    }

    // Address from Airtable Master
    if (master?.Address && !sqsp?.['Shipping Address 1']) {
      contactAddresses.push({
        id: randomUUID(),
        contactId,
        type: 'home',
        line1: master.Address,
        line2: null,
        city: null,
        state: master.REGION || null,
        zip: null,
        country: null,
      });
    }
  }

  // 5. Report
  console.log(`\n=== MERGE RESULTS ===`);
  console.log(`Total contacts:  ${contacts.length}`);
  console.log(`Total tags:      ${contactTags.length}`);
  console.log(`Total addresses: ${contactAddresses.length}`);
  console.log(`\nSkipped:`);
  console.log(`  Test emails:       ${skipped.test}`);
  console.log(`  Spam/do-not-send:  ${skipped.spam}`);
  console.log(`  Blocked:           ${skipped.blocked}`);
  console.log(`  Unverified D1-only:${skipped.unverified_only}`);

  // Source breakdown
  let hasD1 = 0, hasMaster = 0, hasSQSP = 0, hasTier = 0;
  for (const c of contacts) {
    if (d1ByEmail.has(c.email)) hasD1++;
    if (masterByEmail.has(c.email)) hasMaster++;
    if (sqspByEmail.has(c.email)) hasSQSP++;
    if (tierByEmail.has(c.email)) hasTier++;
  }
  console.log(`\nSource coverage in final contacts:`);
  console.log(`  From D1:     ${hasD1}`);
  console.log(`  From Master: ${hasMaster}`);
  console.log(`  From SQSP:   ${hasSQSP}`);
  console.log(`  From 3Tier:  ${hasTier}`);

  // Tag frequency
  const tagCounts = {};
  for (const t of contactTags) {
    tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
  }
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  console.log(`\nTag distribution (top 25):`);
  for (const [tag, count] of sortedTags.slice(0, 25)) {
    console.log(`  ${tag}: ${count}`);
  }

  // With first_seen_at
  const withDate = contacts.filter(c => c.first_seen_at).length;
  console.log(`\nHas first_seen_at: ${withDate}/${contacts.length}`);

  // Date range
  const dates = contacts.filter(c => c.first_seen_at).map(c => c.first_seen_at).sort();
  if (dates.length) {
    console.log(`Date range: ${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`);
  }

  // Sample records
  if (VERBOSE) {
    console.log(`\n=== SAMPLE CONTACTS (10) ===`);
    const samples = contacts.filter(c => c.first_name).slice(0, 10);
    for (const c of samples) {
      const cTags = contactTags.filter(t => t.contactId === c.id).map(t => t.tag);
      console.log(`  ${c.email} | ${c.first_name} ${c.last_name || ''} | seen: ${c.first_seen_at?.slice(0, 10) || '?'} | tags: ${cTags.join(', ') || 'none'} | user_id: ${c.user_id ? 'yes' : 'no'}`);
    }
  }

  // Save merged data for inspection
  writeFileSync('/tmp/crm-contacts-merged.json', JSON.stringify({ contacts, contactTags, contactAddresses }, null, 2));
  console.log(`\nFull merged data saved to /tmp/crm-contacts-merged.json`);

  if (DRY_RUN) {
    console.log(`\n✋ DRY RUN complete. Run with --execute to write to D1.`);
    return;
  }

  // 6. Execute: batch inserts
  console.log(`\n=== WRITING TO D1 ===`);

  // Contacts in batches of 50
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH);
    const stmts = batch.map(c =>
      `INSERT OR IGNORE INTO contact (id, email, first_name, last_name, phone, ig_handle, region, source, landing_page, first_seen_at, total_spent, total_donated, accepts_marketing, notes, user_id, stripe_customer_id) VALUES (${sqlEscape(c.id)}, ${sqlEscape(c.email)}, ${sqlEscape(c.first_name)}, ${sqlEscape(c.last_name)}, ${sqlEscape(c.phone)}, ${sqlEscape(c.ig_handle)}, ${sqlEscape(c.region)}, ${sqlEscape(c.source)}, ${sqlEscape(c.landing_page)}, ${sqlEscape(c.first_seen_at)}, ${c.total_spent}, ${c.total_donated}, ${c.accepts_marketing}, ${sqlEscape(c.notes)}, ${sqlEscape(c.user_id)}, ${sqlEscape(c.stripe_customer_id)});`
    );
    d1Exec(stmts.join('\n'));
    inserted += batch.length;
    process.stdout.write(`\r  Contacts: ${inserted}/${contacts.length}`);
  }
  console.log();

  // Tags in batches of 100
  let tagInserted = 0;
  for (let i = 0; i < contactTags.length; i += BATCH * 2) {
    const batch = contactTags.slice(i, i + BATCH * 2);
    const stmts = batch.map(t =>
      `INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.contactId)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`
    );
    d1Exec(stmts.join('\n'));
    tagInserted += batch.length;
    process.stdout.write(`\r  Tags: ${tagInserted}/${contactTags.length}`);
  }
  console.log();

  // Addresses
  if (contactAddresses.length) {
    let addrInserted = 0;
    for (let i = 0; i < contactAddresses.length; i += BATCH) {
      const batch = contactAddresses.slice(i, i + BATCH);
      const stmts = batch.map(a =>
        `INSERT OR IGNORE INTO contact_address (id, contact_id, type, line1, line2, city, state, zip, country) VALUES (${sqlEscape(a.id)}, ${sqlEscape(a.contactId)}, ${sqlEscape(a.type)}, ${sqlEscape(a.line1)}, ${sqlEscape(a.line2)}, ${sqlEscape(a.city)}, ${sqlEscape(a.state)}, ${sqlEscape(a.zip)}, ${sqlEscape(a.country)});`
      );
      d1Exec(stmts.join('\n'));
      addrInserted += batch.length;
      process.stdout.write(`\r  Addresses: ${addrInserted}/${contactAddresses.length}`);
    }
    console.log();
  }

  // Backfill newsletter_subscriber.contact_id (if column exists)
  try {
    d1Exec(`UPDATE newsletter_subscriber SET contact_id = (SELECT id FROM contact WHERE contact.email = newsletter_subscriber.email COLLATE NOCASE) WHERE contact_id IS NULL;`);
    console.log('  Newsletter subscriber contact_id backfilled.');
  } catch (e) {
    console.log('  Note: newsletter_subscriber.contact_id column not found (add via migration).');
  }

  // Final stats
  const contactCount = d1Query("SELECT COUNT(*) as n FROM contact");
  const tagCount = d1Query("SELECT COUNT(*) as n FROM contact_tag");
  const addrCount = d1Query("SELECT COUNT(*) as n FROM contact_address");
  console.log(`\n=== DONE ===`);
  console.log(`  Contacts:  ${contactCount[0]?.n}`);
  console.log(`  Tags:      ${tagCount[0]?.n}`);
  console.log(`  Addresses: ${addrCount[0]?.n}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
