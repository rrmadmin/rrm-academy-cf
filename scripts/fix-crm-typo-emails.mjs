#!/usr/bin/env node
/**
 * Fix typo emails in CRM contacts with full audit trail.
 *
 * Two modes:
 *   1. SIMPLE: corrected email doesn't exist yet -> update email in place
 *   2. MERGE:  corrected email already exists -> merge typo record into existing
 *
 * Merge rules (per field):
 *   - Survivor: contact with user_id preferred, else the one with corrected email
 *   - first_name/last_name: keep survivor's if set, else take from loser
 *   - first_seen_at: keep earliest
 *   - total_spent/total_donated: keep max
 *   - tags: union (INSERT OR IGNORE)
 *   - addresses: move from loser to survivor
 *   - Loser record is soft-deleted (tagged 'merged:into:{survivor_id}', not hard-deleted)
 *
 * All changes logged to contact_change_log table.
 *
 * Usage:
 *   node scripts/fix-crm-typo-emails.mjs                # dry run
 *   node scripts/fix-crm-typo-emails.mjs --execute       # apply changes
 *   node scripts/fix-crm-typo-emails.mjs --execute --db=rrm-crm-staging
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const DRY_RUN = !process.argv.includes('--execute');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';

// ── Typo corrections (from validation report) ──────────────────────────
const TYPO_FIXES = [
  // Round 1 (completed)
  { email: 'aedoula@protonmail.co', corrected: 'aedoula@protonmail.com' },
  { email: 'brycurtis7@gmail.con', corrected: 'brycurtis7@gmail.com' },
  { email: 'carly.lovenduski@gmai.com', corrected: 'carly.lovenduski@gmail.com' },
  { email: 'cecilie.bwinkelmann@gmail.con', corrected: 'cecilie.bwinkelmann@gmail.com' },
  { email: 'charissadd@icoud.com', corrected: 'charissadd@icloud.com' },
  { email: 'degenhardt.katie@gmail.co', corrected: 'degenhardt.katie@gmail.com' },
  { email: 'kirbi.hunter77@gmail.co', corrected: 'kirbi.hunter77@gmail.com' },
  { email: 'laurabaldwin12@gmsil.com', corrected: 'laurabaldwin12@gmail.com' },
  { email: 'miss.balch@gmsil.com', corrected: 'miss.balch@gmail.com' },
  { email: 'monique.a.daley@gnail.com', corrected: 'monique.a.daley@gmail.com' },
  { email: 'mrs.sarahtmoore@gmail.con', corrected: 'mrs.sarahtmoore@gmail.com' },
  { email: 'nativerosedoula@gmai.com', corrected: 'nativerosedoula@gmail.com' },
  { email: 'sarah.aileen@hotmail.co', corrected: 'sarah.aileen@hotmail.com' },
  { email: 'tayxdavis@gmail.con', corrected: 'tayxdavis@gmail.com' },
  // Round 2: no-MX typos
  { email: 'angelita_11034@hotmail.om', corrected: 'angelita_11034@hotmail.com' },
  { email: 'chantelle@bertino-clarke.con', corrected: 'chantelle@bertino-clarke.com' },
  { email: 'hurst.adele.m@gmail.col', corrected: 'hurst.adele.m@gmail.com' },
  { email: 'lydiavanbuskirk@gmail.col', corrected: 'lydiavanbuskirk@gmail.com' },
  { email: 'kerrilynndiane@gmail.conm', corrected: 'kerrilynndiane@gmail.com' },
  { email: 'madhu.saidot@gmail.comm', corrected: 'madhu.saidot@gmail.com' },
  { email: 'sjm2249@columbai.edu', corrected: 'sjm2249@columbia.edu' },
];

// ── D1 helpers ─────────────────────────────────────────────────────────
function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) return [];
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/crm-typo-fix-batch.sql';
  writeFileSync(tmpFile, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --remote --file=${tmpFile}`, {
      encoding: 'utf8',
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

function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Fix CRM Typo Emails (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}) [DB: ${DB_NAME}] ===\n`);

  // Ensure contact_change_log table exists
  const createLog = `
CREATE TABLE IF NOT EXISTS contact_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT NOT NULL,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    related_contact_id TEXT,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_changelog_contact ON contact_change_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_changelog_action ON contact_change_log(action);`.trim();

  if (!DRY_RUN) {
    d1Exec(createLog);
    console.log('Audit table contact_change_log ensured.\n');
  }

  // Fetch all typo + corrected contacts in one query
  const allEmails = TYPO_FIXES.flatMap(f => [f.email, f.corrected]);
  const emailList = allEmails.map(e => sqlEscape(e)).join(',');
  const contacts = d1Query(`SELECT id, email, first_name, last_name, phone, ig_handle, region, source, landing_page, first_seen_at, total_spent, total_donated, accepts_marketing, notes, user_id, stripe_customer_id FROM contact WHERE email IN (${emailList}) COLLATE NOCASE`);

  const byEmail = new Map();
  for (const c of contacts) {
    byEmail.set(c.email.toLowerCase(), c);
  }

  // Fetch all tags for these contacts
  const contactIds = contacts.map(c => sqlEscape(c.id)).join(',');
  const allTags = contactIds ? d1Query(`SELECT contact_id, tag, source FROM contact_tag WHERE contact_id IN (${contactIds})`) : [];
  const tagsByContact = new Map();
  for (const t of allTags) {
    if (!tagsByContact.has(t.contact_id)) tagsByContact.set(t.contact_id, []);
    tagsByContact.get(t.contact_id).push(t);
  }

  const simpleUpdates = [];
  const merges = [];
  const logEntries = []; // SQL statements for audit trail

  for (const fix of TYPO_FIXES) {
    const typoContact = byEmail.get(fix.email);
    const existingContact = byEmail.get(fix.corrected);

    if (!typoContact) {
      console.log(`  SKIP: ${fix.email} not found (already fixed or missing)`);
      continue;
    }

    if (!existingContact) {
      // Simple: just update the email
      simpleUpdates.push({ typo: typoContact, corrected: fix.corrected });
      console.log(`  SIMPLE: ${fix.email} -> ${fix.corrected}`);
    } else {
      // Merge needed
      // Survivor preference: user_id > more tags > more spend > earlier first_seen
      let survivor, loser;
      const typoHasUser = !!typoContact.user_id;
      const existingHasUser = !!existingContact.user_id;

      if (typoHasUser && !existingHasUser) {
        survivor = typoContact;
        loser = existingContact;
      } else if (existingHasUser && !typoHasUser) {
        survivor = existingContact;
        loser = typoContact;
      } else {
        // Both have or both lack user_id -- prefer the one with the corrected email
        survivor = existingContact;
        loser = typoContact;
      }

      const typoTags = tagsByContact.get(typoContact.id) || [];
      const existingTags = tagsByContact.get(existingContact.id) || [];

      merges.push({
        survivor,
        loser,
        survivorTags: survivor === existingContact ? existingTags : typoTags,
        loserTags: survivor === existingContact ? typoTags : existingTags,
        correctedEmail: fix.corrected,
      });

      console.log(`  MERGE: ${fix.email} + ${fix.corrected} -> survivor: ${survivor.email} (${survivor.user_id ? 'has user' : 'no user'})`);
    }
  }

  console.log(`\n  Simple updates: ${simpleUpdates.length}`);
  console.log(`  Merges: ${merges.length}`);

  if (DRY_RUN) {
    // Print merge details
    for (const m of merges) {
      const sName = `${m.survivor.first_name || ''} ${m.survivor.last_name || ''}`.trim() || '(none)';
      const lName = `${m.loser.first_name || ''} ${m.loser.last_name || ''}`.trim() || '(none)';
      console.log(`\n  --- Merge: ${m.correctedEmail} ---`);
      console.log(`    Survivor: ${m.survivor.email} | ${sName} | user: ${m.survivor.user_id ? 'yes' : 'no'} | spent: $${m.survivor.total_spent} | seen: ${(m.survivor.first_seen_at || '?').slice(0, 10)} | tags: ${m.survivorTags.map(t => t.tag).join(', ') || 'none'}`);
      console.log(`    Loser:    ${m.loser.email} | ${lName} | user: ${m.loser.user_id ? 'yes' : 'no'} | spent: $${m.loser.total_spent} | seen: ${(m.loser.first_seen_at || '?').slice(0, 10)} | tags: ${m.loserTags.map(t => t.tag).join(', ') || 'none'}`);

      // What would change on survivor
      const changes = [];
      if (!m.survivor.first_name && m.loser.first_name) changes.push(`first_name: ${m.loser.first_name}`);
      if (!m.survivor.last_name && m.loser.last_name) changes.push(`last_name: ${m.loser.last_name}`);
      if (m.loser.total_spent > m.survivor.total_spent) changes.push(`total_spent: $${m.survivor.total_spent} -> $${m.loser.total_spent}`);
      if (m.loser.total_donated > m.survivor.total_donated) changes.push(`total_donated: $${m.survivor.total_donated} -> $${m.loser.total_donated}`);
      const mergedSeen = earliest(m.survivor.first_seen_at, m.loser.first_seen_at);
      if (mergedSeen !== m.survivor.first_seen_at) changes.push(`first_seen_at: ${(m.survivor.first_seen_at || '?').slice(0, 10)} -> ${mergedSeen.slice(0, 10)}`);
      const newTags = m.loserTags.filter(lt => !m.survivorTags.some(st => st.tag === lt.tag));
      if (newTags.length) changes.push(`+tags: ${newTags.map(t => t.tag).join(', ')}`);
      // If survivor has the typo email, it needs correction
      if (m.survivor.email === m.loser.email) {
        // This shouldn't happen given our logic, but just in case
      } else if (m.survivor.email !== m.correctedEmail) {
        changes.push(`email: ${m.survivor.email} -> ${m.correctedEmail}`);
      }
      console.log(`    Changes:  ${changes.length ? changes.join(' | ') : '(none)'}`);
    }

    console.log(`\n  DRY RUN complete. Run with --execute to apply.\n`);
    return;
  }

  // ── Execute simple updates ─────────────────────────────────────────
  console.log('\n=== APPLYING CHANGES ===\n');

  for (const u of simpleUpdates) {
    const stmts = [
      // Log the change
      `INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(u.typo.id)}, 'email_typo_fix', 'email', ${sqlEscape(u.typo.email)}, ${sqlEscape(u.corrected)}, 'automated typo correction');`,
      // Update the email
      `UPDATE contact SET email = ${sqlEscape(u.corrected)}, updated_at = datetime('now') WHERE id = ${sqlEscape(u.typo.id)};`,
    ];
    d1Exec(stmts.join('\n'));
    console.log(`  FIXED: ${u.typo.email} -> ${u.corrected}`);
  }

  // ── Execute merges ─────────────────────────────────────────────────
  for (const m of merges) {
    const stmts = [];
    const survivorId = m.survivor.id;
    const loserId = m.loser.id;

    // Log the merge
    stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, related_contact_id, reason) VALUES (${sqlEscape(survivorId)}, 'merge_absorb', 'email', ${sqlEscape(m.survivor.email)}, ${sqlEscape(m.correctedEmail)}, ${sqlEscape(loserId)}, 'typo duplicate merge - absorbed loser');`);
    stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, related_contact_id, reason) VALUES (${sqlEscape(loserId)}, 'merge_retired', 'email', ${sqlEscape(m.loser.email)}, NULL, ${sqlEscape(survivorId)}, 'typo duplicate merge - retired into survivor');`);

    // Build UPDATE for survivor
    const updates = [];

    // Fix email if survivor has the typo
    if (m.survivor.email !== m.correctedEmail) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'email', ${sqlEscape(m.survivor.email)}, ${sqlEscape(m.correctedEmail)}, 'typo correction during merge');`);
      updates.push(`email = ${sqlEscape(m.correctedEmail)}`);
    }

    // Backfill empty names
    if (!m.survivor.first_name && m.loser.first_name) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'first_name', NULL, ${sqlEscape(m.loser.first_name)}, 'backfilled from merged contact');`);
      updates.push(`first_name = ${sqlEscape(m.loser.first_name)}`);
    }
    if (!m.survivor.last_name && m.loser.last_name) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'last_name', NULL, ${sqlEscape(m.loser.last_name)}, 'backfilled from merged contact');`);
      updates.push(`last_name = ${sqlEscape(m.loser.last_name)}`);
    }

    // Keep max spend
    if (m.loser.total_spent > m.survivor.total_spent) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'total_spent', ${sqlEscape(String(m.survivor.total_spent))}, ${sqlEscape(String(m.loser.total_spent))}, 'kept higher value from merged contact');`);
      updates.push(`total_spent = ${m.loser.total_spent}`);
    }
    if (m.loser.total_donated > m.survivor.total_donated) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'total_donated', ${sqlEscape(String(m.survivor.total_donated))}, ${sqlEscape(String(m.loser.total_donated))}, 'kept higher value from merged contact');`);
      updates.push(`total_donated = ${m.loser.total_donated}`);
    }

    // Keep earliest first_seen
    const mergedSeen = earliest(m.survivor.first_seen_at, m.loser.first_seen_at);
    if (mergedSeen && mergedSeen !== m.survivor.first_seen_at) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'first_seen_at', ${sqlEscape(m.survivor.first_seen_at)}, ${sqlEscape(mergedSeen)}, 'kept earlier date from merged contact');`);
      updates.push(`first_seen_at = ${sqlEscape(mergedSeen)}`);
    }

    // Backfill user_id if survivor lacks it
    if (!m.survivor.user_id && m.loser.user_id) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'user_id', NULL, ${sqlEscape(m.loser.user_id)}, 'backfilled from merged contact');`);
      updates.push(`user_id = ${sqlEscape(m.loser.user_id)}`);
    }
    if (!m.survivor.stripe_customer_id && m.loser.stripe_customer_id) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'stripe_customer_id', NULL, ${sqlEscape(m.loser.stripe_customer_id)}, 'backfilled from merged contact');`);
      updates.push(`stripe_customer_id = ${sqlEscape(m.loser.stripe_customer_id)}`);
    }

    // Backfill other empty fields
    for (const field of ['phone', 'ig_handle', 'region', 'source', 'landing_page', 'notes']) {
      if (!m.survivor[field] && m.loser[field]) {
        stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', ${sqlEscape(field)}, NULL, ${sqlEscape(m.loser[field])}, 'backfilled from merged contact');`);
        updates.push(`${field} = ${sqlEscape(m.loser[field])}`);
      }
    }

    // accepts_marketing: keep 1 if either had it
    if (m.loser.accepts_marketing && !m.survivor.accepts_marketing) {
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_field_update', 'accepts_marketing', '0', '1', 'kept opt-in from merged contact');`);
      updates.push(`accepts_marketing = 1`);
    }

    // Retire loser FIRST to free the UNIQUE email constraint before survivor update
    const retiredEmail = `merged:${m.loser.email}`;
    stmts.push(`UPDATE contact SET email = ${sqlEscape(retiredEmail)}, updated_at = datetime('now') WHERE id = ${sqlEscape(loserId)};`);

    // Move tags from loser to survivor (before deleting loser's tags)
    const newTags = m.loserTags.filter(lt => !m.survivorTags.some(st => st.tag === lt.tag));
    for (const t of newTags) {
      stmts.push(`INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(survivorId)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`);
      stmts.push(`INSERT INTO contact_change_log (contact_id, action, field, old_value, new_value, reason) VALUES (${sqlEscape(survivorId)}, 'merge_tag_add', 'tag', NULL, ${sqlEscape(t.tag)}, 'moved from merged contact');`);
    }

    // Move addresses from loser to survivor
    stmts.push(`UPDATE contact_address SET contact_id = ${sqlEscape(survivorId)} WHERE contact_id = ${sqlEscape(loserId)};`);

    // Clean up loser's tags, add merge marker
    stmts.push(`DELETE FROM contact_tag WHERE contact_id = ${sqlEscape(loserId)};`);
    stmts.push(`INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(loserId)}, ${sqlEscape('merged:into:' + survivorId)}, 'validator');`);

    // Now update survivor (email UNIQUE constraint is free)
    updates.push(`updated_at = datetime('now')`);
    stmts.push(`UPDATE contact SET ${updates.join(', ')} WHERE id = ${sqlEscape(survivorId)};`);

    d1Exec(stmts.join('\n'));
    console.log(`  MERGED: ${m.loser.email} -> ${m.survivor.email} (survivor: ${survivorId.slice(0, 12)}..., loser: ${loserId.slice(0, 12)}...)`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  const logCount = d1Query("SELECT COUNT(*) as n FROM contact_change_log");
  const contactCount = d1Query("SELECT COUNT(*) as n FROM contact WHERE email NOT LIKE 'merged:%'");
  console.log(`\n=== DONE ===`);
  console.log(`  Simple fixes:  ${simpleUpdates.length}`);
  console.log(`  Merges:        ${merges.length}`);
  console.log(`  Audit log:     ${logCount[0]?.n} entries`);
  console.log(`  Active contacts: ${contactCount[0]?.n}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
