#!/usr/bin/env node
/**
 * One-time migration: move survey emails from Airtable to D1.
 *
 * Prerequisites:
 *   - AIRTABLE_PAT env var (Airtable personal access token)
 *   - AIRTABLE_SURVEY_BASE env var (Airtable base ID)
 *   - AIRTABLE_SURVEY_TABLE env var (Airtable table ID or name)
 *   - Wrangler authenticated (for D1 remote access)
 *
 * Usage:
 *   AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') \
 *   AIRTABLE_SURVEY_BASE=<base-id> \
 *   AIRTABLE_SURVEY_TABLE=<table-id> \
 *   node scripts/migrate-survey-identities.mjs
 */

import { execSync } from 'child_process';

const { AIRTABLE_PAT, AIRTABLE_SURVEY_BASE, AIRTABLE_SURVEY_TABLE } = process.env;

if (!AIRTABLE_PAT || !AIRTABLE_SURVEY_BASE || !AIRTABLE_SURVEY_TABLE) {
  console.error('Missing required env vars: AIRTABLE_PAT, AIRTABLE_SURVEY_BASE, AIRTABLE_SURVEY_TABLE');
  process.exit(1);
}

const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_SURVEY_BASE}/${AIRTABLE_SURVEY_TABLE}`;
const HEADERS = {
  Authorization: `Bearer ${AIRTABLE_PAT}`,
  'Content-Type': 'application/json',
};
const D1_DB = 'rrm-survey';
const SOURCE = 'endo-survey-v1-backfill';

// --- Airtable helpers ---

async function fetchAllRecordsWithEmail() {
  const records = [];
  let offset = undefined;

  do {
    const params = new URLSearchParams({
      filterByFormula: "NOT({Email}='')",
      'fields[]': 'Email',
      pageSize: '100',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(`${BASE_URL}?${params}`, { headers: HEADERS });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable list failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

async function clearEmailsBatch(recordIds) {
  // Airtable PATCH max 10 per request
  const batches = [];
  for (let i = 0; i < recordIds.length; i += 10) {
    batches.push(recordIds.slice(i, i + 10));
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const body = {
      records: batch.map((id) => ({ id, fields: { Email: '' } })),
    };

    const res = await fetch(BASE_URL, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Airtable PATCH failed (${res.status}): ${text}`);
    }

    console.log(`  Cleared batch ${i + 1}/${batches.length} (${batch.length} records)`);
  }
}

// --- D1 helpers ---

function escapeSql(str) {
  return str.replace(/'/g, "''");
}

function d1Execute(sql) {
  const cmd = `npx wrangler d1 execute ${D1_DB} --remote --command "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function insertIntoD1(records) {
  let inserted = 0;
  let skipped = 0;

  for (const rec of records) {
    const email = escapeSql(rec.fields.Email.trim());
    const recordId = escapeSql(rec.id);
    const sql = `INSERT OR IGNORE INTO survey_identities (email, airtable_record_id, source) VALUES ('${email}', '${recordId}', '${SOURCE}')`;

    try {
      d1Execute(sql);
      inserted++;
    } catch (err) {
      // INSERT OR IGNORE should handle duplicates, but catch wrangler errors
      if (err.message?.includes('UNIQUE constraint')) {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { inserted, skipped };
}

function d1Count() {
  const output = d1Execute('SELECT COUNT(*) as cnt FROM survey_identities');
  // Parse wrangler output for the count
  const match = output.match(/cnt[^\d]*(\d+)/);
  return match ? parseInt(match[1], 10) : '(unable to parse)';
}

// --- Main ---

async function main() {
  console.log('Fetching Airtable records with Email field...');
  const records = await fetchAllRecordsWithEmail();
  console.log(`Fetched ${records.length} records`);

  if (records.length === 0) {
    console.log('No records to migrate. Done.');
    return;
  }

  console.log('Inserting into D1 survey_identities...');
  const { inserted, skipped } = insertIntoD1(records);
  console.log(`D1 inserts: ${inserted} new, ${skipped} skipped`);

  console.log('Clearing emails from Airtable...');
  const recordIds = records.map((r) => r.id);
  await clearEmailsBatch(recordIds);
  console.log('Airtable emails cleared.');

  console.log('Verifying D1 count...');
  const count = d1Count();
  console.log(`D1 survey_identities total rows: ${count}`);

  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
