/**
 * One-time backfill: copy endo-survey symptom records from Airtable into the
 * dedicated D1 DB `rrm-survey-symptoms` (separate from the email/PII DB).
 * rec_id = the Airtable Record ID (preserves the survey_identities join).
 * Idempotent via INSERT OR IGNORE on the rec_id PRIMARY KEY.
 *
 * Env required:
 *   AIRTABLE_PAT          (op://Automation/OpenClaw Airtable PAT/credential)
 *   CLOUDFLARE_API_TOKEN  (op://Automation/CF - D1 Operator - account/credential)
 *
 * Reads work despite the Airtable write cap; this only READS Airtable.
 */
const ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
const DB_ID = '61eecfc7-d65e-4711-a9f4-03dd0c52c67d'; // rrm-survey-symptoms
const AIRTABLE_BASE = 'appb7HeeJQsVe3Jpr';
const AIRTABLE_TABLE = 'tblMAw2tih2ie3ZCu';

const PAT = process.env.AIRTABLE_PAT;
const CF = process.env.CLOUDFLARE_API_TOKEN;
if (!PAT || !CF) { console.error('Missing AIRTABLE_PAT or CLOUDFLARE_API_TOKEN'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    });
    if (resp.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    const j = await resp.json();
    if (!j.success) throw new Error('D1 error: ' + JSON.stringify(j.errors));
    return j.result;
  }
  throw new Error('D1 query failed after retries (429)');
}

async function fetchAllAirtable() {
  const rows = [];
  let offset;
  do {
    const u = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`);
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    let resp;
    for (let attempt = 0; attempt < 5; attempt++) {
      resp = await fetch(u, { headers: { Authorization: `Bearer ${PAT}` } });
      if (resp.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      break;
    }
    const j = await resp.json();
    if (j.error) throw new Error('Airtable error: ' + JSON.stringify(j.error));
    for (const r of j.records) rows.push(r);
    offset = j.offset;
    process.stdout.write(`\r  read ${rows.length} records...`);
  } while (offset);
  process.stdout.write('\n');
  return rows;
}

function mapRow(r) {
  const f = r.fields || {};
  const intOr = (v, d) => (Number.isFinite(v) ? Math.trunc(v) : d);
  return [
    r.id,                                   // rec_id
    intOr(f['Score'], 0),                   // score_total
    intOr(f['Tier 1 Count'], 0),            // score_tier1
    intOr(f['Tier 2 Count'], 0),            // score_tier2
    intOr(f['Tier 3 Count'], 0),            // score_tier3
    f['Tier 1 Symptoms'] ?? '',             // tier1_symptoms
    f['Tier 2 Symptoms'] ?? '',             // tier2_symptoms
    f['Tier 3 Symptoms'] ?? '',             // tier3_symptoms
    'endo-survey-v1-backfill',              // source
    f['User Origin'] ?? null,               // user_origin
    Number.isFinite(f['Viewport Width']) ? Math.trunc(f['Viewport Width']) : null, // viewport_width
    f['Device Type'] ?? null,               // device_type
    f['Source'] ?? null,                    // referrer
    f['Submitted'] || r.createdTime,        // submitted_at (fallback to Airtable createdTime)
  ];
}

const COLS = 'rec_id,score_total,score_tier1,score_tier2,score_tier3,tier1_symptoms,tier2_symptoms,tier3_symptoms,source,user_origin,viewport_width,device_type,referrer,submitted_at';
const PH = '(' + Array(14).fill('?').join(',') + ')';

async function main() {
  console.log('Reading Airtable...');
  const records = await fetchAllAirtable();
  const AIRTABLE_TOTAL = records.length;
  console.log(`AIRTABLE_TOTAL = ${AIRTABLE_TOTAL}`);

  const rows = records.map(mapRow);
  const CHUNK = 7; // D1 caps bound params at 100/query; 7 rows * 14 cols = 98
  let sent = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const sql = `INSERT OR IGNORE INTO survey_symptoms (${COLS}) VALUES ` + chunk.map(() => PH).join(',');
    const params = chunk.flat();
    await d1Query(sql, params);
    sent += chunk.length;
    process.stdout.write(`\r  inserted ${sent}/${rows.length}...`);
  }
  process.stdout.write('\n');

  const res = await d1Query("SELECT count(*) AS n FROM survey_symptoms WHERE source='endo-survey-v1-backfill'");
  const D1_COUNT = res[0].results[0].n;
  console.log(`D1 backfill count = ${D1_COUNT}`);
  console.log(`AIRTABLE_TOTAL    = ${AIRTABLE_TOTAL}`);
  if (D1_COUNT !== AIRTABLE_TOTAL) {
    console.error(`ABORT: count mismatch (D1 ${D1_COUNT} != Airtable ${AIRTABLE_TOTAL})`);
    process.exit(2);
  }
  console.log('OK: exact match. Backfill complete.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
