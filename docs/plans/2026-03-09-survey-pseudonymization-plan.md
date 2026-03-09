# Survey Pseudonymization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split survey PII (email) from health data (symptoms) across two systems so neither is useful alone if breached.

**Architecture:** New D1 database (`rrm-survey`) holds email-to-Airtable-record mappings. Airtable holds anonymous symptom data. KV tokens have email stripped after submission and TTL reduced to 24h.

**Tech Stack:** Cloudflare D1, KV, Airtable API, AWS SES (alerts), Analytics Engine (logging)

**Design doc:** `docs/plans/2026-03-09-survey-pseudonymization-design.md`

---

### Task 1: Create D1 Database and Binding

**Files:**
- Modify: `wrangler.toml`

**Step 1: Create the D1 database via Wrangler**

```bash
npx wrangler d1 create rrm-survey
```

Copy the `database_id` from the output.

**Step 2: Add D1 binding to wrangler.toml**

Add after the existing `[[d1_databases]]` block:

```toml
[[d1_databases]]
binding = "SURVEY_DB"
database_name = "rrm-survey"
database_id = "<id-from-step-1>"
```

**Step 3: Create the table**

```bash
npx wrangler d1 execute rrm-survey --command "CREATE TABLE survey_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'endo-survey-v1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);"

npx wrangler d1 execute rrm-survey --command "CREATE INDEX idx_survey_identities_email ON survey_identities(email);"
```

**Step 4: Verify**

```bash
npx wrangler d1 execute rrm-survey --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Expected: `survey_identities` in output.

**Step 5: Commit**

```bash
git add wrangler.toml
git commit -m "infra: add rrm-survey D1 database binding for survey pseudonymization"
```

---

### Task 2: Reduce Token TTL

**Files:**
- Modify: `functions/api/survey/request.js:22`

**Step 1: Change TOKEN_TTL**

In `request.js` line 22, change:

```js
const TOKEN_TTL = 90 * 24 * 60 * 60; // 90 days in seconds
```

to:

```js
const TOKEN_TTL = 24 * 60 * 60; // 24 hours in seconds
```

**Step 2: Commit**

```bash
git add functions/api/survey/request.js
git commit -m "security: reduce survey token TTL from 90 days to 24 hours"
```

---

### Task 3: Modify submit.js -- Remove Email from Airtable, Add D1 Write

**Files:**
- Modify: `functions/api/survey/submit.js`

This is the core change. The new flow:
1. Validate token (unchanged)
2. Mark token used (unchanged)
3. POST symptoms to Airtable **without email**
4. Parse Airtable response to get record ID
5. INSERT email + record ID into D1
6. On D1 failure: log error + send alert email (do NOT fail silently)
7. Strip email from KV token
8. Return success

**Step 1: Add SES import and TOKEN_TTL constant**

At top of file, add import:

```js
import { sendEmail } from '../_ses.js';
```

Add constant after CORS_HEADERS:

```js
const TOKEN_TTL = 24 * 60 * 60; // 24 hours -- match request.js
```

**Step 2: Add env check for SURVEY_DB**

In the env validation block (line 29-34), add a check:

```js
if (!env.SURVEY_DB) {
  return json({ ok: false, error: 'Server misconfigured' }, 500);
}
```

**Step 3: Remove Email from Airtable fields**

In the `fields` object (line 73-85), remove:

```js
Email: data.email,
```

**Step 4: Parse Airtable record ID from response**

After `if (!airtableResp.ok)` error handling block (after line 106), add:

```js
const airtableData = await airtableResp.json();
const airtableRecordId = airtableData.records?.[0]?.id;
if (!airtableRecordId) {
  log(env, waitUntil, 'survey', 'airtable_no_record_id', 'error', 'Airtable returned no record ID', 0, 502);
  return json({ ok: false, error: 'Failed to save results. Please try again.' }, 502);
}
```

**Step 5: Insert into D1 with failure alerting**

After the Airtable record ID extraction:

```js
// Link identity to anonymous survey record
try {
  await env.SURVEY_DB.prepare(
    'INSERT INTO survey_identities (email, airtable_record_id, source) VALUES (?, ?, ?)'
  ).bind(data.email, airtableRecordId, 'endo-survey-v1').run();
} catch (d1Err) {
  // CRITICAL: Do not fail silently. Log + alert for manual recovery.
  const detail = `D1 write failed: email=${data.email} record=${airtableRecordId} err=${d1Err.message}`;
  log(env, waitUntil, 'survey', 'd1_identity_write_error', 'error', detail, 0, 500);

  // Send alert email (fire-and-forget)
  const alertFn = async () => {
    try {
      await sendEmail(env, {
        from: 'RRM Academy <alerts@mail.rrmacademy.org>',
        to: 'administrator@rrmacademy.org',
        subject: 'ALERT: Survey identity link failed',
        text: `D1 write failed during survey submission.\n\nEmail: ${data.email}\nAirtable Record ID: ${airtableRecordId}\nError: ${d1Err.message}\nTimestamp: ${new Date().toISOString()}\n\nManual action required: INSERT into survey_identities or link this record manually.`,
      });
    } catch (emailErr) {
      log(env, waitUntil, 'survey', 'd1_alert_email_failed', 'error', emailErr.message, 0, 500);
    }
  };
  waitUntil(alertFn());
}
```

**Step 6: Strip email from KV token**

After the D1 write block, replace the existing token data with email removed:

```js
// Strip email from KV token (pseudonymization)
const stripped = { ...updated, email: undefined };
delete stripped.email;
await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(stripped), {
  expirationTtl: TOKEN_TTL,
});
```

Also update the earlier `expirationTtl` references (lines 66-68 and 102-104) from `90 * 24 * 60 * 60` to `TOKEN_TTL`.

**Step 7: Verify submit.js compiles**

```bash
npm run build
```

Expected: No build errors.

**Step 8: Commit**

```bash
git add functions/api/survey/submit.js
git commit -m "security: pseudonymize survey data -- split email from symptoms

Email stored in D1 survey_identities, symptoms in Airtable without PII.
KV token email stripped after submission. D1 failure triggers Telegram + email alert."
```

---

### Task 4: Update Security Guard

**Files:**
- Modify: `scripts/guard.mjs` (if submit.js is guarded)
- Modify: `guard-manifest.json`

**Step 1: Check if submit.js is guarded**

```bash
grep -c "survey/submit" scripts/guard.mjs
```

If 0: skip to step 3. If guarded: run guard update.

**Step 2: Update guard manifest**

```bash
npm run guard:update
```

**Step 3: Run guard to verify**

```bash
npm run guard
```

Expected: All PASS.

**Step 4: Commit (if manifest changed)**

```bash
git add guard-manifest.json
git commit -m "chore: update guard manifest after survey submit changes"
```

---

### Task 5: Migration Script

**Files:**
- Create: `scripts/migrate-survey-identities.mjs`

**Step 1: Write the migration script**

```js
#!/usr/bin/env node
/**
 * One-time migration: move survey emails from Airtable to D1 survey_identities.
 *
 * Prerequisites:
 *   AIRTABLE_PAT -- Airtable personal access token
 *   Wrangler authenticated (for D1 access)
 *
 * Usage:
 *   AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') node scripts/migrate-survey-identities.mjs
 *
 * What it does:
 *   1. Fetches all Airtable survey records with a populated Email field
 *   2. Inserts email + record ID into D1 survey_identities (source: endo-survey-v1-backfill)
 *   3. Clears the Email field in Airtable
 *   4. Idempotent: UNIQUE constraint on airtable_record_id skips duplicates
 */

import { execSync } from 'child_process';

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
if (!AIRTABLE_PAT) {
  console.error('AIRTABLE_PAT required. Run with:');
  console.error("  AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') node scripts/migrate-survey-identities.mjs");
  process.exit(1);
}

// These match the CF Pages env vars for the survey
const AIRTABLE_SURVEY_BASE = process.env.AIRTABLE_SURVEY_BASE;
const AIRTABLE_SURVEY_TABLE = process.env.AIRTABLE_SURVEY_TABLE;
const D1_DATABASE = 'rrm-survey';

if (!AIRTABLE_SURVEY_BASE || !AIRTABLE_SURVEY_TABLE) {
  console.error('AIRTABLE_SURVEY_BASE and AIRTABLE_SURVEY_TABLE required.');
  console.error('Check CF Pages env vars or wrangler.toml for values.');
  process.exit(1);
}

async function fetchRecordsWithEmail(offset) {
  const params = new URLSearchParams({
    filterByFormula: "NOT({Email} = '')",
    fields: ['Email'],
    pageSize: '100',
  });
  if (offset) params.set('offset', offset);

  const resp = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_SURVEY_BASE}/${AIRTABLE_SURVEY_TABLE}?${params}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } }
  );
  if (!resp.ok) throw new Error(`Airtable fetch failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function clearAirtableEmails(records) {
  // Airtable allows max 10 records per PATCH
  const batches = [];
  for (let i = 0; i < records.length; i += 10) {
    batches.push(records.slice(i, i + 10));
  }

  for (const batch of batches) {
    const body = {
      records: batch.map(r => ({ id: r.id, fields: { Email: '' } })),
    };
    const resp = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_SURVEY_BASE}/${AIRTABLE_SURVEY_TABLE}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`  WARN: Airtable PATCH failed for batch: ${err}`);
    }
  }
}

function d1Execute(sql) {
  return execSync(
    `npx wrangler d1 execute ${D1_DATABASE} --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

async function main() {
  console.log('=== Survey Identity Migration ===\n');

  // Fetch all records with email
  let allRecords = [];
  let offset = undefined;
  do {
    const page = await fetchRecordsWithEmail(offset);
    allRecords = allRecords.concat(page.records);
    offset = page.offset;
    console.log(`  Fetched ${allRecords.length} records so far...`);
  } while (offset);

  console.log(`\nTotal records with email: ${allRecords.length}\n`);
  if (allRecords.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  // Insert into D1
  let inserted = 0;
  let skipped = 0;
  for (const record of allRecords) {
    const email = record.fields.Email?.trim().toLowerCase();
    if (!email) continue;

    try {
      d1Execute(
        `INSERT OR IGNORE INTO survey_identities (email, airtable_record_id, source) VALUES ('${email.replace(/'/g, "''")}', '${record.id}', 'endo-survey-v1-backfill')`
      );
      inserted++;
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        skipped++;
      } else {
        console.error(`  ERROR inserting ${record.id}: ${err.message}`);
      }
    }
  }

  console.log(`D1 inserts: ${inserted} new, ${skipped} skipped (already existed)\n`);

  // Clear emails from Airtable
  console.log('Clearing emails from Airtable...');
  await clearAirtableEmails(allRecords);
  console.log('Done.\n');

  // Verify
  console.log('Verification:');
  const count = d1Execute('SELECT COUNT(*) as count FROM survey_identities;');
  console.log(`  D1 survey_identities: ${count.trim()}`);
  console.log('\n=== Migration complete ===');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

**Step 2: Test dry-run (verify it can connect)**

```bash
AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') \
AIRTABLE_SURVEY_BASE=<base-id> \
AIRTABLE_SURVEY_TABLE=<table-id> \
node scripts/migrate-survey-identities.mjs
```

Note: Get `AIRTABLE_SURVEY_BASE` and `AIRTABLE_SURVEY_TABLE` from CF Pages env vars:
```bash
npx wrangler pages secret list --project-name rrm-academy 2>/dev/null || echo "Check CF dashboard for env var values"
```

**Step 3: Commit**

```bash
git add scripts/migrate-survey-identities.mjs
git commit -m "feat: add one-time survey identity migration script"
```

---

### Task 6: Deploy and Run Migration

**Step 1: Push all changes**

```bash
git push origin main
```

Wait for GitHub Actions build to succeed.

**Step 2: Verify D1 binding is live**

After deploy, the `SURVEY_DB` binding should be active. Test by checking CF dashboard or:

```bash
npx wrangler d1 execute rrm-survey --command "SELECT COUNT(*) FROM survey_identities;"
```

Expected: `0` (empty table before migration).

**Step 3: Run migration**

```bash
AIRTABLE_PAT=$(op read 'op://Automation/OpenClaw Airtable PAT/credential') \
AIRTABLE_SURVEY_BASE=<base-id> \
AIRTABLE_SURVEY_TABLE=<table-id> \
node scripts/migrate-survey-identities.mjs
```

**Step 4: Verify migration**

```bash
npx wrangler d1 execute rrm-survey --command "SELECT COUNT(*) FROM survey_identities;"
npx wrangler d1 execute rrm-survey --command "SELECT source, COUNT(*) as n FROM survey_identities GROUP BY source;"
```

Expected: All records have `source = 'endo-survey-v1-backfill'`.

**Step 5: Verify Airtable emails are cleared**

Check a few records in Airtable to confirm Email field is now empty.

---

### Task 7: End-to-End Test

**Step 1: Request a survey link**

Navigate to `https://rrmacademy.org/endo-survey/`, enter a test email, submit.

**Step 2: Check KV token**

```bash
npx wrangler kv key get --namespace-id ef52bc09f1b44b5f8e3367372be8d63d "token:<token-from-email-link>"
```

Verify: token contains email (not yet submitted).

**Step 3: Complete the survey**

Click link in email, check some symptoms, click Calculate (after consent checkbox).

**Step 4: Verify pseudonymization**

Check Airtable: new record should have symptoms but **no email**.

Check D1:
```bash
npx wrangler d1 execute rrm-survey --command "SELECT * FROM survey_identities ORDER BY id DESC LIMIT 1;"
```

Should show: email + airtable record ID + `source = 'endo-survey-v1'`.

Check KV token again: email field should be stripped.

**Step 5: Verify token expiry**

Confirm the token TTL is 24 hours (check KV metadata if possible, or wait and re-validate after 24h).
