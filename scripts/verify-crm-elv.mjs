#!/usr/bin/env node
/**
 * Verify CRM emails via EmailListVerify (ELV) API.
 *
 * Runs AFTER validate-crm-emails.mjs (which does local 7-layer checks).
 * This script sends emails to ELV for SMTP-level mailbox verification --
 * the one thing we can't do ourselves.
 *
 * ELV response statuses:
 *   ok           - valid, deliverable
 *   ok_for_all   - valid (accept-all server, but mailbox confirmed)
 *   accept_all   - catch-all domain (can't confirm individual mailbox)
 *   email_disabled - mailbox doesn't exist (will bounce)
 *   spamtrap     - known spam trap address
 *   disposable   - disposable/temporary email
 *   risky        - risky address (role, free provider, etc.)
 *   unknown      - couldn't determine (timeout, greylisting)
 *   invalid      - invalid syntax or domain
 *   role         - role-based address (info@, admin@, etc.)
 *
 * Usage:
 *   node scripts/verify-crm-elv.mjs                    # dry run (report only)
 *   node scripts/verify-crm-elv.mjs --tag              # report + tag contacts in D1
 *   node scripts/verify-crm-elv.mjs --resume           # resume from checkpoint
 *   node scripts/verify-crm-elv.mjs --db=rrm-auth      # specify database
 *
 * Credits: 1 per email. ~6,480 contacts = ~6,480 credits (10.1K available).
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';

const TAG_MODE = process.argv.includes('--tag');
const RESUME = process.argv.includes('--resume');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';
const CONCURRENCY = 5; // conservative -- avoid rate limits
const CHECKPOINT_FILE = '/tmp/crm-elv-checkpoint.json';
const REPORT_FILE = '/tmp/crm-elv-results.json';

// ELV statuses we consider safe to send to
const SENDABLE = new Set(['ok', 'ok_for_all']);
// Risky but possibly deliverable
const RISKY = new Set(['accept_all', 'unknown', 'risky', 'role']);
// Do not send
const UNSENDABLE = new Set(['email_disabled', 'spamtrap', 'disposable', 'invalid']);

// ── 1Password ────────────────────────────────────────────────────────
function getElvKey() {
  try {
    return execSync("op read 'op://Automation/EmailListVerify/credential'", {
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error('ERROR: Could not read ELV API key from 1Password.');
    console.error('Run: op read "op://Automation/EmailListVerify/credential"');
    process.exit(1);
  }
}

// ── D1 helpers ─────────────────────────────────────────────────────────
function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8',
    cwd: process.env.HOME + '/iCode/projects/rrm-academy-cf',
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`d1Query: no JSON:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/crm-elv-batch.sql';
  writeFileSync(tmpFile, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile}`, {
      encoding: 'utf8',
      cwd: process.env.HOME + '/iCode/projects/rrm-academy-cf',
      maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function sqlEscape(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ── ELV API ───────────────────────────────────────────────────────────
async function verifyEmail(apiKey, email) {
  const url = `https://apps.emaillistverify.com/api/verifyEmail?secret=${apiKey}&email=${encodeURIComponent(email)}&timeout=15`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { status: 'error', raw: `HTTP ${resp.status}: ${text}` };
    }
    const text = (await resp.text()).trim().toLowerCase();
    return { status: text, raw: text };
  } catch (err) {
    return { status: 'error', raw: err.message };
  }
}

// ── Checkpoint ────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (!RESUME || !existsSync(CHECKPOINT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCheckpoint(verified) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(verified));
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const apiKey = getElvKey();

  console.log(`\n=== ELV Email Verifier [DB: ${DB_NAME}] ===`);
  console.log(`Mode: ${TAG_MODE ? 'REPORT + TAG' : 'REPORT ONLY (dry run)'}`);
  console.log(`Resume: ${RESUME}\n`);

  // Fetch all active contacts
  const contacts = d1Query(
    "SELECT id, email, first_name, last_name FROM contact WHERE email NOT LIKE 'merged:%' ORDER BY email"
  );
  console.log(`Active contacts: ${contacts.length}`);

  // Load checkpoint (email -> status)
  const verified = loadCheckpoint();
  const alreadyDone = Object.keys(verified).length;
  if (alreadyDone) {
    console.log(`Checkpoint: ${alreadyDone} already verified`);
  }

  // Build work queue (skip already-verified)
  const queue = contacts
    .map(c => ({
      ...c,
      email: (c.email || '').toLowerCase().trim(),
      name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    }))
    .filter(c => c.email && c.email.includes('@') && !verified[c.email]);

  console.log(`To verify: ${queue.length}`);
  console.log(`Credits needed: ~${queue.length}\n`);

  if (queue.length === 0 && alreadyDone === 0) {
    console.log('No contacts to verify.');
    return;
  }

  // Verify in batches
  let processed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (c) => {
        const result = await verifyEmail(apiKey, c.email);
        return { contact: c, result };
      })
    );

    for (const { contact, result } of results) {
      verified[contact.email] = result.status;
      if (result.status === 'error') errors++;
    }

    processed += batch.length;

    // Checkpoint every 50 emails
    if (processed % 50 === 0 || processed === queue.length) {
      saveCheckpoint(verified);
    }

    // Progress
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const eta = queue.length > processed ? Math.round((queue.length - processed) / rate) : 0;
    process.stdout.write(
      `\r  ${processed}/${queue.length} verified (${rate.toFixed(1)}/s, ETA ${eta}s, ${errors} errors)`
    );

    // Small delay between batches to be respectful
    if (i + CONCURRENCY < queue.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  console.log('\n');

  // ── Tally results ──────────────────────────────────────────────────
  // Map all contacts (including previously checkpointed) to their status
  const allContacts = contacts.map(c => ({
    ...c,
    email: (c.email || '').toLowerCase().trim(),
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
  }));

  const buckets = {
    sendable: [],    // ok, ok_for_all
    risky: [],       // accept_all, unknown, risky, role
    unsendable: [],  // email_disabled, spamtrap, disposable, invalid
    unverified: [],  // no ELV result (skipped, error)
  };

  const statusCounts = {};

  for (const c of allContacts) {
    const status = verified[c.email];
    if (!status) {
      buckets.unverified.push(c);
      continue;
    }
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (SENDABLE.has(status)) {
      buckets.sendable.push({ ...c, elvStatus: status });
    } else if (RISKY.has(status)) {
      buckets.risky.push({ ...c, elvStatus: status });
    } else if (UNSENDABLE.has(status) || status === 'error') {
      buckets.unsendable.push({ ...c, elvStatus: status });
    } else {
      // Unknown status -- treat as risky
      buckets.risky.push({ ...c, elvStatus: status });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────
  console.log('=== ELV VERIFICATION RESULTS ===\n');
  console.log(`  Sendable (ok):        ${buckets.sendable.length}`);
  console.log(`  Risky (accept_all+):  ${buckets.risky.length}`);
  console.log(`  Unsendable:           ${buckets.unsendable.length}`);
  console.log(`  Unverified:           ${buckets.unverified.length}`);
  console.log(`  ─────────────────────────`);
  console.log(`  Total:                ${allContacts.length}`);

  console.log('\n  Status breakdown:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status.padEnd(18)} ${count}`);
  }

  // Show unsendable details
  if (buckets.unsendable.length) {
    console.log(`\n--- UNSENDABLE (${buckets.unsendable.length}) ---`);
    const byStatus = new Map();
    for (const c of buckets.unsendable) {
      if (!byStatus.has(c.elvStatus)) byStatus.set(c.elvStatus, []);
      byStatus.get(c.elvStatus).push(c);
    }
    for (const [status, items] of byStatus) {
      console.log(`  ${status} (${items.length}):`);
      for (const c of items.slice(0, 20)) {
        console.log(`    ${c.email} (${c.name || 'no name'})`);
      }
      if (items.length > 20) console.log(`    ... and ${items.length - 20} more`);
    }
  }

  // Show risky details (summarized)
  if (buckets.risky.length) {
    console.log(`\n--- RISKY (${buckets.risky.length}) ---`);
    const byStatus = new Map();
    for (const c of buckets.risky) {
      if (!byStatus.has(c.elvStatus)) byStatus.set(c.elvStatus, []);
      byStatus.get(c.elvStatus).push(c);
    }
    for (const [status, items] of byStatus) {
      console.log(`  ${status} (${items.length}):`);
      for (const c of items.slice(0, 5)) {
        console.log(`    ${c.email}`);
      }
      if (items.length > 5) console.log(`    ... and ${items.length - 5} more`);
    }
  }

  // Newsletter readiness
  console.log(`\n=== NEWSLETTER READINESS ===`);
  console.log(`  Safe to send:        ${buckets.sendable.length}`);
  console.log(`  Risky (consider):    ${buckets.risky.length}`);
  console.log(`  Do not send:         ${buckets.unsendable.length}`);
  console.log(`  Max (safe + risky):  ${buckets.sendable.length + buckets.risky.length}`);

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    db: DB_NAME,
    totalContacts: allContacts.length,
    creditsUsed: queue.length,
    statusCounts,
    buckets: {
      sendable: buckets.sendable.length,
      risky: buckets.risky.length,
      unsendable: buckets.unsendable.length,
      unverified: buckets.unverified.length,
    },
    unsendable: buckets.unsendable,
    risky: buckets.risky,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\nFull report: ${REPORT_FILE}`);

  // ── Tag contacts in D1 ────────────────────────────────────────────
  if (!TAG_MODE) {
    console.log('\nRun with --tag to write ELV tags to D1.');
    return;
  }

  console.log('\n=== TAGGING CONTACTS ===');
  const tags = [];

  for (const c of buckets.sendable) {
    tags.push({ id: c.id, tag: `elv:${c.elvStatus}`, source: 'emaillistverify' });
  }
  for (const c of buckets.risky) {
    tags.push({ id: c.id, tag: `elv:${c.elvStatus}`, source: 'emaillistverify' });
  }
  for (const c of buckets.unsendable) {
    tags.push({ id: c.id, tag: `elv:${c.elvStatus}`, source: 'emaillistverify' });
  }

  if (!tags.length) {
    console.log('  No tags to write.');
    return;
  }

  const BATCH = 50;
  for (let i = 0; i < tags.length; i += BATCH) {
    const batch = tags.slice(i, i + BATCH);
    const stmts = batch.map(t =>
      `INSERT OR REPLACE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.id)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`
    );
    d1Exec(stmts.join('\n'));
    process.stdout.write(`\r  ${Math.min(i + BATCH, tags.length)}/${tags.length} tags`);
  }
  console.log('');
  console.log(`  Wrote ${tags.length} tags`);

  // Clean up checkpoint on success
  try { unlinkSync(CHECKPOINT_FILE); } catch {}
  console.log('  Checkpoint cleared.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
