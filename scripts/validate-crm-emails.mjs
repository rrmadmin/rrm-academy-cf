#!/usr/bin/env node
/**
 * Validate all CRM contact emails through the production 7-layer validator.
 *
 * Layers (from _email-validate.js):
 *   0. Structural cleanup (regex fixes)
 *   1. Syntax check
 *   2. Exact-match typo map
 *   3. Disposable domain blocklist (~5,200)
 *   4. Provider TLD correction (@gmail.net -> @gmail.com)
 *   5. Sift3 fuzzy domain matching
 *   6. MX record check via Cloudflare DoH
 *
 * Usage:
 *   node scripts/validate-crm-emails.mjs              # report only
 *   node scripts/validate-crm-emails.mjs --tag        # report + tag contacts in D1
 *   node scripts/validate-crm-emails.mjs --tag --db=rrm-crm-staging
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { validateEmail, TYPO_CORRECTIONS } from '../functions/api/auth/_email-validate.js';

const TAG_MODE = process.argv.includes('--tag');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';
const CONCURRENCY = 10;

// ── D1 helpers ─────────────────────────────────────────────────────────
function d1Query(sql) {
  const escaped = sql.replace(/'/g, "'\\''");
  const out = execSync(`npx wrangler d1 execute ${DB_NAME} --remote --command '${escaped}'`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`d1Query: no JSON:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start))[0]?.results || [];
}

function d1Exec(sql) {
  const tmpFile = '/tmp/crm-validate-batch.sql';
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

// ── MX pre-check (domain-level cache to avoid redundant DoH lookups) ──
// validateEmail() does per-email MX checks. For 5,000+ contacts sharing
// ~2,000 domains, we pre-resolve MX at the domain level, then skip
// validateEmail's MX layer for domains we already know are bad.
const mxCache = new Map();

async function checkMxDomain(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) { mxCache.set(domain, true); return true; }
    const data = await resp.json();
    if (data.Answer?.length > 0) { mxCache.set(domain, true); return true; }

    // A record fallback
    const aResp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) }
    );
    if (!aResp.ok) { mxCache.set(domain, true); return true; }
    const aData = await aResp.json();
    const result = !!(aData.Answer?.length > 0);
    mxCache.set(domain, result);
    return result;
  } catch {
    mxCache.set(domain, true); // fail-open
    return true;
  }
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== CRM Email Validator [DB: ${DB_NAME}] ===`);
  console.log(`Validator: 7-layer (_email-validate.js)`);
  console.log(`Typo corrections loaded: ${TYPO_CORRECTIONS.size}\n`);

  // Fetch active contacts
  const contacts = d1Query("SELECT id, email, first_name, last_name FROM contact WHERE email NOT LIKE 'merged:%' ORDER BY email");
  console.log(`Active contacts: ${contacts.length}\n`);

  const results = {
    valid: [],
    disposable: [],
    typo: [],       // suggestion AND original domain has no MX (real typo)
    noMx: [],
    syntaxBad: [],
    otherInvalid: [],
  };

  // Prep contacts
  const allContacts = contacts.map(c => ({
    ...c,
    email: (c.email || '').toLowerCase().trim(),
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
  }));

  // Phase 1: Pre-warm MX cache for all unique domains
  // This lets us distinguish real typos from legitimate international domains.
  // validateEmail's fuzzy matcher flags hotmail.co.uk -> hotmail.com, me.com -> mail.com, etc.
  // If the original domain has valid MX, the suggestion is a false positive.
  const domainSet = new Map();
  for (const c of allContacts) {
    const domain = c.email.split('@')[1];
    if (!domain) continue;
    if (!domainSet.has(domain)) domainSet.set(domain, []);
    domainSet.get(domain).push(c);
  }

  const domains = [...domainSet.keys()];
  console.log(`Pre-checking MX for ${domains.length} unique domains...`);

  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    const batch = domains.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(d => checkMxDomain(d)));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, domains.length)}/${domains.length} domains`);
  }
  console.log('\n');

  // Phase 2: Run validateEmail per contact, cross-check suggestions against MX
  console.log('Running 7-layer validation...');

  for (let i = 0; i < allContacts.length; i += CONCURRENCY) {
    const batch = allContacts.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (c) => {
      const result = await validateEmail(c.email);
      return { contact: c, result };
    }));

    for (const { contact, result } of batchResults) {
      if (result.valid) {
        results.valid.push(contact);
      } else if (result.suggestion) {
        // Cross-check: if the original domain has valid MX, the fuzzy
        // suggestion is a false positive (e.g. hotmail.co.uk, me.com, ymail.com).
        // Only flag as typo if original domain has NO MX records.
        const domain = contact.email.split('@')[1];
        const hasMx = mxCache.get(domain);
        if (hasMx) {
          results.valid.push(contact); // legitimate domain, ignore suggestion
        } else {
          results.typo.push({ ...contact, suggestion: result.suggestion, error: result.error });
        }
      } else if (result.error?.includes('Disposable')) {
        results.disposable.push(contact);
      } else if (result.error?.includes('does not appear to accept mail')) {
        results.noMx.push(contact);
      } else if (result.error?.includes('valid email address') || result.error === 'Email is required.') {
        results.syntaxBad.push({ ...contact, error: result.error });
      } else {
        results.otherInvalid.push({ ...contact, error: result.error });
      }
    }

    const processed = Math.min(i + CONCURRENCY, allContacts.length);
    if (processed % 100 === 0 || processed === allContacts.length) {
      process.stdout.write(`\r  ${processed}/${allContacts.length} emails`);
    }
  }
  console.log('\n');

  // ── Report ─────────────────────────────────────────────────────────
  console.log('=== VALIDATION RESULTS ===\n');
  console.log(`  Valid (sendable):     ${results.valid.length}`);
  console.log(`  Typo (correctable):   ${results.typo.length}`);
  console.log(`  Disposable:           ${results.disposable.length}`);
  console.log(`  No MX record:         ${results.noMx.length}`);
  console.log(`  Syntax invalid:       ${results.syntaxBad.length}`);
  console.log(`  Other invalid:        ${results.otherInvalid.length}`);
  const totalBad = results.disposable.length + results.typo.length + results.noMx.length + results.syntaxBad.length + results.otherInvalid.length;
  console.log(`  ─────────────────────────`);
  console.log(`  Total:                ${contacts.length}`);
  console.log(`  Total bad:            ${totalBad}`);

  if (results.typo.length) {
    console.log(`\n--- TYPO SUGGESTIONS (${results.typo.length}) ---`);
    for (const r of results.typo) {
      console.log(`  ${r.email} -> ${r.suggestion} (${r.name || 'no name'})`);
    }
  }

  if (results.disposable.length) {
    console.log(`\n--- DISPOSABLE (${results.disposable.length}) ---`);
    for (const r of results.disposable) {
      console.log(`  ${r.email} (${r.name || 'no name'})`);
    }
  }

  if (results.noMx.length) {
    console.log(`\n--- NO MX RECORD (${results.noMx.length}) ---`);
    const byDomain = new Map();
    for (const r of results.noMx) {
      const domain = r.email.split('@')[1];
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(r);
    }
    for (const [domain, items] of byDomain) {
      console.log(`  ${domain} (${items.length} contacts):`);
      for (const c of items) {
        console.log(`    ${c.email} (${c.name || 'no name'})`);
      }
    }
  }

  if (results.syntaxBad.length) {
    console.log(`\n--- SYNTAX INVALID (${results.syntaxBad.length}) ---`);
    for (const r of results.syntaxBad) {
      console.log(`  ${r.email} -- ${r.error}`);
    }
  }

  if (results.otherInvalid.length) {
    console.log(`\n--- OTHER INVALID (${results.otherInvalid.length}) ---`);
    for (const r of results.otherInvalid) {
      console.log(`  ${r.email} -- ${r.error}`);
    }
  }

  // Newsletter readiness
  console.log(`\n=== NEWSLETTER READINESS ===`);
  console.log(`  Ready to send:       ${results.valid.length}`);
  console.log(`  Recoverable (typo):  ${results.typo.length}`);
  console.log(`  Unsendable:          ${results.disposable.length + results.noMx.length + results.syntaxBad.length + results.otherInvalid.length}`);
  console.log(`  Max potential:       ${results.valid.length + results.typo.length}`);

  // Save full report
  writeFileSync('/tmp/crm-email-validation.json', JSON.stringify(results, null, 2));
  console.log('\nFull report: /tmp/crm-email-validation.json');

  // ── Tag contacts in D1 ─────────────────────────────────────────────
  if (!TAG_MODE) {
    console.log('\nRun with --tag to write validation tags to D1.');
    return;
  }

  console.log('\n=== TAGGING CONTACTS ===');
  const tags = [];

  for (const r of results.valid) {
    tags.push({ id: r.id, tag: 'email:valid', source: 'validator' });
  }
  for (const r of results.disposable) {
    tags.push({ id: r.id, tag: 'email:disposable', source: 'validator' });
  }
  for (const r of results.typo) {
    // Store the suggestion in source so we can auto-correct later
    tags.push({ id: r.id, tag: 'email:typo', source: `validator:${r.suggestion}` });
  }
  for (const r of results.noMx) {
    tags.push({ id: r.id, tag: 'email:no-mx', source: 'validator' });
  }
  for (const r of results.syntaxBad) {
    tags.push({ id: r.id, tag: 'email:invalid', source: 'validator' });
  }
  for (const r of results.otherInvalid) {
    tags.push({ id: r.id, tag: 'email:invalid', source: 'validator' });
  }

  if (!tags.length) {
    console.log('  No tags to write.');
    return;
  }

  const BATCH = 50;
  for (let i = 0; i < tags.length; i += BATCH) {
    const batch = tags.slice(i, i + BATCH);
    const stmts = batch.map(t =>
      `INSERT INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.id)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)}) ON CONFLICT(contact_id, tag) DO UPDATE SET source = excluded.source;`
    );
    d1Exec(stmts.join('\n'));
    process.stdout.write(`\r  ${Math.min(i + BATCH, tags.length)}/${tags.length} tags`);
  }
  console.log('');
  console.log(`  Wrote ${tags.length} tags (${results.valid.length} valid, ${results.disposable.length} disposable, ${results.typo.length} typo, ${results.noMx.length} no-mx, ${results.syntaxBad.length + results.otherInvalid.length} invalid)`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
