#!/usr/bin/env node
/**
 * import-wix-members.mjs
 *
 * Reads 6 Wix contact-export CSVs from ~/Downloads/, deduplicates on email,
 * and emits D1-compatible SQL for users, user_labels, and enrollments.
 *
 * Usage:
 *   node scripts/import-wix-members.mjs > scripts/import-members.sql 2>scripts/import-summary.txt
 */

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DOWNLOADS = join(homedir(), 'Downloads');

/** CSV files to process, in order.  `filterSource` means only import rows
 *  whose Source column equals the given value. null = import all rows. */
const CSV_FILES = [
  { file: 'contacts (1).csv', filterSource: 'Site Members' },
  { file: 'contacts (2).csv', filterSource: null },
  { file: 'contacts (3).csv', filterSource: null },
  { file: 'contacts (4).csv', filterSource: null },
  { file: 'contacts (5).csv', filterSource: null },
  { file: 'contacts (6).csv', filterSource: null },
];

/** Existing D1 users — skip user INSERT but still create labels/enrollments */
const EXISTING_EMAILS = new Set([
  'brianrwhittaker@gmail.com',
  'lexiedphillips@gmail.com',
  'breannaleigh26@yahoo.com',
  'mdibartolo25@gmail.com',
]);

/** Label → course_id mapping for enrollment generation */
const LABEL_TO_COURSE = {
  'Masterclass in Endometriosis & Surgery': 'masterclass-endo-surgery',
  'Masterclass in Endometriosis and Surgery': 'masterclass-endo-surgery',
  'Long Term Endometriosis Management': 'long-term-endo-management',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'rrm-vs-ivf',
  'Postpartum Depression & Anxiety: a restorative approach to recovery': 'postpartum-depression-anxiety',
};

// ---------------------------------------------------------------------------
// RFC 4180 CSV parser  (handles BOM, quoted fields with embedded commas/newlines/quotes)
// ---------------------------------------------------------------------------

function parseCSV(text) {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row = [];
    while (i < len) {
      // start of field
      if (i < len && text[i] === '"') {
        // quoted field
        i++; // skip opening quote
        let field = '';
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              // escaped quote
              field += '"';
              i += 2;
            } else {
              // end of quoted field
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
      } else {
        // unquoted field
        let field = '';
        while (i < len && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          field += text[i];
          i++;
        }
        row.push(field);
      }

      // after field: comma means more fields, newline means end of row
      if (i < len && text[i] === ',') {
        i++; // skip comma, continue to next field
      } else {
        break; // end of row
      }
    }

    // skip newline(s)
    while (i < len && (text[i] === '\r' || text[i] === '\n')) i++;

    // skip completely empty rows (trailing newline)
    if (row.length === 1 && row[0] === '') continue;

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a CSV file into an array of objects keyed by header name.
 * Normalises header names: strips BOM, trims whitespace.
 */
function readCSVFile(path) {
  const text = readFileSync(path, 'utf-8');
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  const data = [];

  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (rows[r][c] || '').trim();
    }
    data.push(obj);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId() {
  return randomUUID().replace(/-/g, '');
}

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Accumulator:  email → { firstName, lastName, email, wixMemberId, createdAt, labels: Set, source }
const contacts = new Map();

let stats = {
  csvRows: 0,
  filteredOut: 0,
  noEmail: 0,
  duplicatesMerged: 0,
  existingSkipped: 0,
  usersInserted: 0,
  labelsInserted: 0,
  enrollmentsInserted: 0,
  blockedUsers: 0,
};

for (const { file, filterSource } of CSV_FILES) {
  const path = join(DOWNLOADS, file);
  const rows = readCSVFile(path);
  const stderr = process.stderr;

  stderr.write(`Reading ${file}: ${rows.length} data rows\n`);

  for (const row of rows) {
    stats.csvRows++;

    // Source filter (only for CSV 1)
    if (filterSource && row['Source'] !== filterSource) {
      stats.filteredOut++;
      continue;
    }

    const email = (row['Email 1'] || '').toLowerCase().trim();
    if (!email) {
      stats.noEmail++;
      continue;
    }

    const firstName = (row['First Name'] || '').trim();
    const lastName = (row['Last Name'] || '').trim();
    const labelsRaw = (row['Labels'] || '').trim();
    const createdAt = (row['Created At (UTC+0)'] || '').trim();
    const wixMemberId = (row['# User ID'] || '').trim();

    const labels = labelsRaw
      ? labelsRaw.split(';').map(l => l.trim()).filter(Boolean)
      : [];

    if (contacts.has(email)) {
      // Merge: union labels, keep first occurrence's name/wixMemberId
      const existing = contacts.get(email);
      for (const l of labels) existing.labels.add(l);
      stats.duplicatesMerged++;
    } else {
      contacts.set(email, {
        firstName,
        lastName,
        email,
        wixMemberId,
        createdAt,
        labels: new Set(labels),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Generate SQL
// ---------------------------------------------------------------------------

const sql = [];
sql.push('-- Wix member import — generated ' + new Date().toISOString());
sql.push("-- Do NOT edit by hand.  Re-run import-wix-members.mjs to regenerate.\n");
sql.push('BEGIN TRANSACTION;\n');

for (const [email, c] of contacts) {
  const id = newId();
  const name = `${c.firstName} ${c.lastName}`.trim();
  const labelsArr = [...c.labels];
  const isBlocked = labelsArr.some(l => l.startsWith('Spam')) ? 1 : 0;
  if (isBlocked) stats.blockedUsers++;

  const isExisting = EXISTING_EMAILS.has(email);

  // --- user INSERT (skip for existing D1 users) ---
  if (isExisting) {
    stats.existingSkipped++;
    sql.push(`-- Existing user: ${email} — skipping user INSERT`);
  } else {
    stats.usersInserted++;
    sql.push(
      `INSERT OR IGNORE INTO user (id, email, email_verified, hashed_password, name, first_name, last_name, wix_member_id, blocked, role, created_at)` +
      ` VALUES (${sqlEscape(id)}, ${sqlEscape(email)}, 1, '', ${sqlEscape(name)}, ${sqlEscape(c.firstName)}, ${sqlEscape(c.lastName)}, ${sqlEscape(c.wixMemberId || null)}, ${isBlocked}, 'member', ${sqlEscape(c.createdAt || new Date().toISOString())});`
    );
  }

  // For existing users, we need to reference them by email in a subquery
  const userIdExpr = isExisting
    ? `(SELECT id FROM user WHERE email = ${sqlEscape(email)})`
    : sqlEscape(id);

  // --- user_label INSERTs ---
  for (const label of labelsArr) {
    stats.labelsInserted++;
    sql.push(
      `INSERT OR IGNORE INTO user_label (user_id, label) VALUES (${userIdExpr}, ${sqlEscape(label)});`
    );
  }

  // --- enrollment INSERTs ---
  const enrolledCourses = new Set();
  for (const label of labelsArr) {
    const courseId = LABEL_TO_COURSE[label];
    if (courseId && !enrolledCourses.has(courseId)) {
      enrolledCourses.add(courseId);
      stats.enrollmentsInserted++;
      const enrollId = newId();
      sql.push(
        `INSERT OR IGNORE INTO enrollment (id, user_id, course_id, enrolled_at) VALUES (${sqlEscape(enrollId)}, ${userIdExpr}, ${sqlEscape(courseId)}, ${sqlEscape(c.createdAt || new Date().toISOString())});`
      );
    }
  }

  sql.push(''); // blank line between contacts for readability
}

sql.push('COMMIT;');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

process.stdout.write(sql.join('\n') + '\n');

// Summary to stderr
const summary = `
=== Wix Member Import Summary ===
CSV rows read:        ${stats.csvRows}
Filtered out (source):${stats.filteredOut}
Skipped (no email):   ${stats.noEmail}
Duplicates merged:    ${stats.duplicatesMerged}
Unique contacts:      ${contacts.size}
Existing D1 users:    ${stats.existingSkipped}
New user INSERTs:     ${stats.usersInserted}
Label INSERTs:        ${stats.labelsInserted}
Enrollment INSERTs:   ${stats.enrollmentsInserted}
Blocked (spam):       ${stats.blockedUsers}
==================================
`.trim();

process.stderr.write('\n' + summary + '\n');
