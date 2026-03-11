#!/usr/bin/env node
/**
 * Validate all CRM contact emails through 3 layers:
 * 1. Disposable domain check
 * 2. Domain typo detection
 * 3. MX record check via Cloudflare DoH
 *
 * Usage:
 *   node scripts/validate-crm-emails.mjs              # report only
 *   node scripts/validate-crm-emails.mjs --tag        # report + tag invalid contacts in D1
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';

const TAG_MODE = process.argv.includes('--tag');
const DB_NAME = (process.argv.find(a => a.startsWith('--db=')) || '').split('=')[1] || 'rrm-auth';

// ── Load disposable domains ────────────────────────────────────────────
// Re-use the same blocklist from the validator
const disposableFile = new URL('../functions/api/auth/_disposable-domains.js', import.meta.url);
const disposableSource = readFileSync(disposableFile, 'utf8');
// Extract domain strings from the Set constructor
const domainMatches = disposableSource.match(/'([^']+)'/g);
const DISPOSABLE_DOMAINS = new Set(domainMatches ? domainMatches.map(d => d.slice(1, -1)) : []);
console.log(`Loaded ${DISPOSABLE_DOMAINS.size} disposable domains`);

// ── Load typo corrections ──────────────────────────────────────────────
const DOMAIN_TYPOS = {
  'gmail.com': ['gmial.com', 'gmal.com', 'gmai.com', 'gmali.com', 'gamil.com', 'gnail.com', 'gmaill.com', 'gmil.com', 'gmail.co', 'gmail.cm', 'gmsil.com', 'gmqil.com', 'gmail.con', 'gmail.cim', 'gmail.vom', 'gmail.xom', 'gmaik.com', 'gmaikl.com', 'gmailcom', 'g]mail.com', 'gmail.col', 'gmail.conm', 'gmail.comm', 'gmail.cpm', 'gmail.ocm', 'gmail.coom'],
  'yahoo.com': ['yaho.com', 'yahooo.com', 'yhoo.com', 'yhaoo.com', 'yahoo.co', 'yahoo.cm', 'yahoo.con', 'yaoo.com', 'tahoo.com', 'uahoo.com'],
  'hotmail.com': ['hotmal.com', 'hotmai.com', 'hotmial.com', 'hotamil.com', 'hotmail.co', 'hotmail.cm', 'hotmail.con', 'hotmaill.com', 'htmail.com', 'htomail.com', 'hotmail.om', 'hotmwil.com', 'homail.com', 'hotmali.com', 'hotmeil.com'],
  'outlook.com': ['outlok.com', 'outloo.com', 'outlool.com', 'outllook.com', 'outlook.co', 'outlook.cm', 'outlook.con', 'putlook.com', 'outtlook.com'],
  'icloud.com': ['iclod.com', 'icloud.co', 'icloud.cm', 'iclould.com', 'icloud.con', 'icoud.com', 'iclous.com', 'icluod.com'],
  'aol.com': ['aol.co', 'aol.cm', 'aol.con', 'ao.com', 'aoll.com'],
  'protonmail.com': ['protonmal.com', 'protonmai.com', 'protonmail.co', 'protonmail.cm', 'protonmail.con'],
  'proton.me': ['proton.m', 'proton.mr', 'protn.me'],
  'comcast.net': ['comcast.ner', 'comcast.met', 'comcast.ne', 'comcat.net', 'comcst.net'],
  'live.com': ['live.co', 'live.cm', 'live.con'],
  'msn.com': ['msn.co', 'msn.cm', 'msn.con'],
  'att.net': ['att.ner', 'att.met', 'att.ne'],
  'sbcglobal.net': ['sbcglobal.ner', 'sbcglobal.ne', 'sbcglobal.met'],
  'verizon.net': ['verizon.ner', 'verizon.ne', 'verizon.met'],
  'me.com': ['me.co', 'me.cm'],
  'mac.com': ['mac.co', 'mac.cm'],
};

const TYPO_CORRECTIONS = new Map();
for (const [correct, typos] of Object.entries(DOMAIN_TYPOS)) {
  for (const typo of typos) {
    TYPO_CORRECTIONS.set(typo, correct);
  }
}

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

// ── MX check ───────────────────────────────────────────────────────────
const mxCache = new Map();

async function checkMxRecord(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);

  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) { mxCache.set(domain, true); return true; }
    const data = await resp.json();
    if (data.Answer && data.Answer.length > 0) { mxCache.set(domain, true); return true; }

    // A record fallback
    const aResp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) }
    );
    if (!aResp.ok) { mxCache.set(domain, true); return true; }
    const aData = await aResp.json();
    const result = aData.Answer && aData.Answer.length > 0;
    mxCache.set(domain, result);
    return result;
  } catch {
    mxCache.set(domain, true); // fail-open
    return true;
  }
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== CRM Email Validator [DB: ${DB_NAME}] ===\n`);

  // Fetch active contacts (skip retired merge losers)
  const contacts = d1Query("SELECT id, email, first_name, last_name FROM contact WHERE email NOT LIKE 'merged:%' ORDER BY email");
  console.log(`Active contacts: ${contacts.length}\n`);

  const results = {
    disposable: [],   // { id, email, domain }
    typo: [],         // { id, email, domain, suggestion }
    noMx: [],         // { id, email, domain }
    valid: [],        // { id, email }
  };

  // Collect unique domains for MX batch check
  const domainContacts = new Map(); // domain -> [{ id, email }]
  const alreadyFlagged = new Set();

  for (const c of contacts) {
    const email = (c.email || '').toLowerCase().trim();
    const domain = email.split('@')[1];
    if (!domain) continue;

    // Layer 1: Disposable
    if (DISPOSABLE_DOMAINS.has(domain)) {
      results.disposable.push({ id: c.id, email, domain, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() });
      alreadyFlagged.add(c.id);
      continue;
    }

    // Layer 2: Typo
    const correction = TYPO_CORRECTIONS.get(domain);
    if (correction) {
      const [local] = email.split('@');
      results.typo.push({ id: c.id, email, domain, suggestion: `${local}@${correction}`, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() });
      alreadyFlagged.add(c.id);
      continue;
    }

    // Queue for MX check
    if (!domainContacts.has(domain)) domainContacts.set(domain, []);
    domainContacts.get(domain).push({ id: c.id, email, name: `${c.first_name || ''} ${c.last_name || ''}`.trim() });
  }

  // Layer 3: MX checks (batch by domain, 10 concurrent)
  const domains = [...domainContacts.keys()];
  console.log(`Checking MX records for ${domains.length} unique domains...`);

  const CONCURRENCY = 10;
  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    const batch = domains.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(batch.map(d => checkMxRecord(d).then(ok => ({ domain: d, ok }))));

    for (const { domain, ok } of checks) {
      if (!ok) {
        for (const c of domainContacts.get(domain)) {
          results.noMx.push({ id: c.id, email: c.email, domain, name: c.name });
        }
      } else {
        for (const c of domainContacts.get(domain)) {
          results.valid.push({ id: c.id, email: c.email });
        }
      }
    }

    process.stdout.write(`\r  Checked ${Math.min(i + CONCURRENCY, domains.length)}/${domains.length} domains`);
  }
  console.log('\n');

  // ── Report ─────────────────────────────────────────────────────────
  console.log('=== VALIDATION RESULTS ===\n');
  console.log(`Valid:      ${results.valid.length}`);
  console.log(`Disposable: ${results.disposable.length}`);
  console.log(`Typo:       ${results.typo.length}`);
  console.log(`No MX:      ${results.noMx.length}`);
  console.log(`Total bad:  ${results.disposable.length + results.typo.length + results.noMx.length}`);

  if (results.disposable.length) {
    console.log('\n--- DISPOSABLE DOMAINS ---');
    for (const r of results.disposable) {
      console.log(`  ${r.email} (${r.name || 'no name'}) [${r.domain}]`);
    }
  }

  if (results.typo.length) {
    console.log('\n--- TYPO SUGGESTIONS ---');
    for (const r of results.typo) {
      console.log(`  ${r.email} -> ${r.suggestion} (${r.name || 'no name'})`);
    }
  }

  if (results.noMx.length) {
    console.log('\n--- NO MX RECORD ---');
    // Group by domain for readability
    const byDomain = new Map();
    for (const r of results.noMx) {
      if (!byDomain.has(r.domain)) byDomain.set(r.domain, []);
      byDomain.get(r.domain).push(r);
    }
    for (const [domain, contacts] of byDomain) {
      console.log(`  ${domain} (${contacts.length} contacts):`);
      for (const c of contacts) {
        console.log(`    ${c.email} (${c.name || 'no name'})`);
      }
    }
  }

  // Save full report
  writeFileSync('/tmp/crm-email-validation.json', JSON.stringify(results, null, 2));
  console.log('\nFull report saved to /tmp/crm-email-validation.json');

  // ── Tag invalid contacts in D1 ────────────────────────────────────
  if (TAG_MODE) {
    console.log('\n=== TAGGING INVALID CONTACTS ===');
    const tags = [];

    for (const r of results.disposable) {
      tags.push({ contactId: r.id, tag: 'email:disposable', source: 'validator' });
    }
    for (const r of results.typo) {
      tags.push({ contactId: r.id, tag: 'email:typo', source: 'validator' });
    }
    for (const r of results.noMx) {
      tags.push({ contactId: r.id, tag: 'email:no-mx', source: 'validator' });
    }

    if (tags.length) {
      const BATCH = 50;
      for (let i = 0; i < tags.length; i += BATCH) {
        const batch = tags.slice(i, i + BATCH);
        const stmts = batch.map(t =>
          `INSERT OR IGNORE INTO contact_tag (contact_id, tag, source) VALUES (${sqlEscape(t.contactId)}, ${sqlEscape(t.tag)}, ${sqlEscape(t.source)});`
        );
        d1Exec(stmts.join('\n'));
      }
      console.log(`  Tagged ${tags.length} contacts (${results.disposable.length} disposable, ${results.typo.length} typo, ${results.noMx.length} no-mx)`);
    } else {
      console.log('  No invalid contacts to tag.');
    }
  } else {
    console.log('\nRun with --tag to tag invalid contacts in D1.');
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
