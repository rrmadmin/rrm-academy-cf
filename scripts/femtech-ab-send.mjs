#!/usr/bin/env node
/**
 * One-off A/B email trickle sender — FemTech commentary + STUC event broadcast.
 *
 * DEFAULTS TO DRY-RUN. No email is sent and nothing is written to D1 unless you
 * pass --send. Dry-run prints cohort/exclusion/split counts plus one fully
 * rendered sample of each variant (with a REAL minted unsubscribe URL) and a
 * UTM-leak assertion on the content links.
 *
 *   node scripts/femtech-ab-send.mjs            # dry-run (safe, default)
 *   node scripts/femtech-ab-send.mjs --send     # actually send + log to email_log
 *
 * Conventions replicated (NOT invented) from the live codebase:
 *   - SES send: functions/api/_ses.js sendRawEmail (SESv2 raw MIME via aws4fetch,
 *     region AWS_SES_REGION || 'us-east-1', Precedence: bulk, List-Unsubscribe).
 *   - Unsubscribe token: functions/api/newsletter/_tracking.js hmacToken(email,
 *     secret, bucket) = HMAC-SHA256 over `${email}:${bucket}`, HEX digest. The
 *     live unsubscribe endpoint reads ?e=&t=&b= (NOT ?email=&token=). Verified
 *     against the live one-click POST: a token minted here returns 200.
 *   - CAN-SPAM footer/address: functions/api/newsletter/_template.js.
 *   - Trickle pacing: mirrors the batch loop in functions/api/newsletter/send.js
 *     (Promise.allSettled per batch + setTimeout between batches), with the
 *     batch size / delay this task specifies (5 / ~1800ms).
 *
 * Secrets (1Password service account):
 *   - SES key id:  op item get "RRM AWS - IAM Access Key (rrm-ses-sender)" --vault Automation --fields "access key id" --reveal
 *   - SES secret:  op item get "RRM AWS - IAM Access Key (rrm-ses-sender)" --vault Automation --fields "secret access key" --reveal
 *     (op:// refs can't address this item — the title contains parentheses — so
 *      it is read via `op item get --fields`.)
 *   - NEWSLETTER_SECRET: op read 'op://Automation/RRM Academy Newsletter Secret/credential'
 *
 * Cloudflare (for wrangler d1 execute in non-interactive shells):
 *   - CLOUDFLARE_API_TOKEN: op read 'op://Automation/CF - Worker Deploy - account/credential'
 *   - CLOUDFLARE_ACCOUNT_ID: ecf2c5bc8b5ebd634bcb587b3890910a
 *   If these are already exported in the environment, they are used as-is.
 */

import { AwsClient } from 'aws4fetch';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEND = process.argv.includes('--send');

const SITE_URL = 'https://rrmacademy.org';
const FROM = '"Dr. Naomi Whittaker" <newsletter@mail.rrmacademy.org>';
const REPLY_TO = 'community@rrmacademy.org';
const SUBJECT = 'Is your cycle app helping you, or misleading you?';

// SES configuration set that actually exists in us-east-1 (send.js hardcodes the
// non-existent 'rrm-newsletter' -- a latent bug in that never-used path).
const CONFIGURATION_SET = 'rrm-email';

// Trickle pacing (this task's spec; loop shape mirrors send.js).
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1800;

// CAN-SPAM physical postal address — VERBATIM from functions/api/newsletter/_template.js.
const POSTAL_ADDRESS =
  'RRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011';

// Hard excludes (lowercased) — never email these regardless of cohort membership.
const HARD_EXCLUDES = [
  'michele@nurturingwomen.org',
  'brianrwhittaker@gmail.com',
  'administrator@rrmacademy.org',
];

// Suppression tags — any contact carrying one of these is excluded.
const SUPPRESSION_TAGS = [
  'wix:unsubscribed',
  'wix:bounced',
  'email:bounced',
  'email:complained',
  'elv:spamtrap',
  'elv:invalid',
  'elv:disposable',
  'elv:dead_server',
  'elv:email_disabled',
  'elv:antispam_system',
];

// ---------------------------------------------------------------------------
// Email bodies (content authoritative per task; {{UNSUBSCRIBE}} replaced below)
// ---------------------------------------------------------------------------

const BODY_A = `<p>You already know your cycle carries real diagnostic signal. So this question matters more for you than most.</p>
<p><strong><a href="https://rrmacademy.org/commentary/is-your-cycle-app-helping-or-misleading-you/">Read: Is Your Cycle App Helping You, or Misleading You?</a></strong></p>
<p>The new piece walks through what consumer cycle apps actually measure, where their algorithms fall short, and what that gap costs you when symptoms matter most.</p>
<p>Tonight at 6:30 PM Eastern inside Save the Uterus Club, Mikayla Dalton joins us for a live conversation: "FemTech: Power or Pitfall?" If the article opens the question for you, the talk will take it further. <a href="https://rrmacademy.org/events/femtech-power-or-pitfall-mikayla-dalton/">Details and access here.</a></p>
<p>Dr. Naomi Whittaker</p>
{{UNSUBSCRIBE}}`;

const BODY_B = `<p>You already know your cycle carries real diagnostic signal. Tonight at 6:30 PM Eastern, we go deeper.</p>
<p>Mikayla Dalton joins us live inside Save the Uterus Club for "FemTech: Power or Pitfall?" She'll cover what consumer cycle apps actually get right, where they mislead you, and what to do about the gap.</p>
<p>If you've ever wondered whether your app is showing you the full picture, this is the conversation.</p>
<p><strong><a href="https://rrmacademy.org/events/femtech-power-or-pitfall-mikayla-dalton/">Join us tonight inside Save the Uterus Club.</a></strong></p>
<p>Dr. Naomi Whittaker</p>
{{UNSUBSCRIBE}}`;

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

function opItemField(title, vault, field) {
  return execFileSync(
    'op',
    ['item', 'get', title, '--vault', vault, '--fields', field, '--reveal'],
    { encoding: 'utf8' }
  ).trim();
}

function opRead(ref) {
  return execFileSync('op', ['read', ref], { encoding: 'utf8' }).trim();
}

function resolveSecrets() {
  let awsKeyId, awsSecret, newsletterSecret;
  try {
    awsKeyId = opItemField('RRM AWS - IAM Access Key (rrm-ses-sender)', 'Automation', 'access key id');
    awsSecret = opItemField('RRM AWS - IAM Access Key (rrm-ses-sender)', 'Automation', 'secret access key');
  } catch (err) {
    fail(`Could not resolve AWS SES credentials from 1Password: ${err.message}`);
  }
  try {
    newsletterSecret = opRead('op://Automation/RRM Academy Newsletter Secret/credential');
  } catch (err) {
    fail(`Could not resolve NEWSLETTER_SECRET from 1Password: ${err.message}`);
  }
  if (!awsKeyId || !awsSecret) fail('AWS SES credentials resolved empty.');
  if (!newsletterSecret) fail('NEWSLETTER_SECRET resolved empty — STOPPING (refuse to send without working unsubscribe tokens).');
  return { awsKeyId, awsSecret, newsletterSecret };
}

function resolveCfEnv() {
  const env = { ...process.env };
  if (!env.CLOUDFLARE_API_TOKEN) {
    try {
      env.CLOUDFLARE_API_TOKEN = opRead('op://Automation/CF - Worker Deploy - account/credential');
    } catch (err) {
      fail(`Could not resolve CLOUDFLARE_API_TOKEN: ${err.message}`);
    }
  }
  if (!env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
  return env;
}

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

const CF_ENV = resolveCfEnv();

function d1(db, sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', env: CF_ENV, maxBuffer: 64 * 1024 * 1024 }
  );
  // wrangler prepends a non-JSON banner on some paths; slice from the first '['.
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`wrangler returned no JSON for: ${sql.slice(0, 80)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

const norm = (e) => String(e || '').trim().toLowerCase();
const sqlList = (arr) => arr.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(',');

// ---------------------------------------------------------------------------
// Cohort + dedup
// ---------------------------------------------------------------------------

function buildCohort() {
  // (1) Base cohort: recent survey contacts.
  const baseRows = d1(
    'rrm-auth',
    `SELECT DISTINCT lower(email) AS email FROM contact
     WHERE source='survey' AND created_at > datetime('now','-30 days')
       AND email IS NOT NULL AND TRIM(email) != ''`
  );
  const base = new Set(baseRows.map((r) => norm(r.email)).filter(Boolean));

  // (2a) STUC members.
  const stucRows = d1(
    'rrm-auth',
    `SELECT DISTINCT lower(c.email) AS email FROM contact c
     JOIN contact_tag ct ON ct.contact_id = c.id
     WHERE ct.tag = 'stuc:member' AND c.email IS NOT NULL AND TRIM(c.email) != ''`
  );
  const stuc = new Set(stucRows.map((r) => norm(r.email)).filter(Boolean));

  // (2b) femtech-mvp waitlist (every email).
  const ftRows = d1(
    'femtech-mvp',
    `SELECT lower(email) AS email FROM waitlist WHERE email IS NOT NULL AND TRIM(email) != ''`
  );
  const femtech = new Set(ftRows.map((r) => norm(r.email)).filter(Boolean));

  // (2c) Hard excludes.
  const hard = new Set(HARD_EXCLUDES.map(norm));

  // (2d) Suppressions: suppression-tagged contacts + email_log unsubscribed.
  const supTagRows = d1(
    'rrm-auth',
    `SELECT DISTINCT lower(c.email) AS email FROM contact c
     JOIN contact_tag ct ON ct.contact_id = c.id
     WHERE ct.tag IN (${sqlList(SUPPRESSION_TAGS)})
       AND c.email IS NOT NULL AND TRIM(c.email) != ''`
  );
  const supTag = new Set(supTagRows.map((r) => norm(r.email)).filter(Boolean));

  const unsubRows = d1(
    'rrm-auth',
    `SELECT DISTINCT lower(email) AS email FROM email_log
     WHERE event = 'unsubscribed' AND email IS NOT NULL AND TRIM(email) != ''`
  );
  const unsub = new Set(unsubRows.map((r) => norm(r.email)).filter(Boolean));

  // Apply exclusions against the base cohort (count overlaps relative to base).
  const inBase = (s) => [...s].filter((e) => base.has(e));
  const counts = {
    base: base.size,
    excl_stuc: inBase(stuc).length,
    excl_femtech: inBase(femtech).length,
    excl_hard: inBase(hard).length,
    excl_suppression_tag: inBase(supTag).length,
    excl_unsubscribed_log: inBase(unsub).length,
  };

  const excluded = new Set([...stuc, ...femtech, ...hard, ...supTag, ...unsub]);
  const finalList = [...base].filter((e) => !excluded.has(e)).sort();

  counts.final = finalList.length;
  return { finalList, counts };
}

// ---------------------------------------------------------------------------
// Deterministic 50/50 split
// ---------------------------------------------------------------------------

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Deterministic split: sort by sha256(email) hex, then alternate A/B down the
 * sorted list. Stable for a given input set so a re-run reproduces the same
 * assignment (a resend never reshuffles variants).
 */
function assignVariants(emails) {
  const sorted = [...emails].sort((a, b) => {
    const ha = sha256hex(a);
    const hb = sha256hex(b);
    return ha < hb ? -1 : ha > hb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  return sorted.map((email, i) => ({ email, variant: i % 2 === 0 ? 'A' : 'B' }));
}

// ---------------------------------------------------------------------------
// Unsubscribe token + rendering
// ---------------------------------------------------------------------------

function currentBucket() {
  const now = new Date();
  return `${now.getUTCFullYear()}Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

// Replicates functions/api/newsletter/_tracking.js hmacToken: HMAC-SHA256 over
// `${email}:${bucket}`, HEX digest. (The project code uses hex, and the live
// endpoint verifies hex — confirmed via a live one-click POST probe.)
function hmacToken(email, secret, bucket = currentBucket()) {
  return crypto.createHmac('sha256', secret).update(`${email}:${bucket}`).digest('hex');
}

// Replicates _tracking.js unsubscribeUrl: ?e=&t=&b= against the live endpoint.
function unsubscribeUrl(email, secret) {
  const bucket = currentBucket();
  const token = hmacToken(email, secret, bucket);
  return `${SITE_URL}/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=${token}&b=${encodeURIComponent(bucket)}`;
}

// Builds the {{UNSUBSCRIBE}} replacement block: the per-task unsubscribe <p> plus
// the verbatim CAN-SPAM postal-address footer from _template.js.
function unsubscribeBlock(unsubUrl) {
  return (
    `<p style="font-size:12px;color:#888"><a href="${unsubUrl}">Unsubscribe</a></p>` +
    `<p style="font-size:11px;color:#999;margin-top:16px;border-top:1px solid #eee;padding-top:12px;">${POSTAL_ADDRESS}</p>`
  );
}

function renderHtml(variant, email, newsletterSecret) {
  const body = variant === 'A' ? BODY_A : BODY_B;
  const unsubUrl = unsubscribeUrl(email, newsletterSecret);
  const html = body.replace('{{UNSUBSCRIBE}}', unsubscribeBlock(unsubUrl));
  // Plain-text fallback mirrors _template.js: strip tags + append address + unsub.
  const text =
    body.replace('{{UNSUBSCRIBE}}', '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim() +
    `\n\n---\n${POSTAL_ADDRESS}\nUnsubscribe: ${unsubUrl}`;
  return { html, text, unsubUrl };
}

// Assert no UTM / tracking params on the two content links in either body.
function contentLinkUtmLeaks() {
  const leaks = [];
  const urlRe = /href="(https:\/\/rrmacademy\.org\/[^"]+)"/g;
  for (const [name, body] of [['A', BODY_A], ['B', BODY_B]]) {
    let m;
    while ((m = urlRe.exec(body)) !== null) {
      const url = m[1];
      if (/[?&](utm_|gclid|fbclid|mc_eid|mc_cid|ref=)/i.test(url)) leaks.push(`${name}: ${url}`);
    }
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// SES send — replicates functions/api/_ses.js sendRawEmail
// ---------------------------------------------------------------------------

function sanitizeHeader(v) {
  const s = String(v ?? '');
  if (/[\r\n\x00]/.test(s)) throw new Error('Header contains illegal control characters');
  return s.slice(0, 998);
}

function makeAwsClient(awsKeyId, awsSecret) {
  const region = process.env.AWS_SES_REGION || 'us-east-1';
  const aws = new AwsClient({ accessKeyId: awsKeyId, secretAccessKey: awsSecret, region, service: 'ses' });
  return { aws, region };
}

async function sendRawEmail(aws, region, { from, to, subject, html, text, replyTo, headers, configurationSet }) {
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const toAddr = sanitizeHeader(to);
  const messageId = `<${crypto.randomUUID()}@mail.rrmacademy.org>`;

  const rawHeaders = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${toAddr}`,
    `Subject: ${sanitizeHeader(subject)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Precedence: bulk',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (replyTo) rawHeaders.push(`Reply-To: ${sanitizeHeader(replyTo)}`);
  if (headers) for (const [n, v] of Object.entries(headers)) rawHeaders.push(`${sanitizeHeader(n)}: ${sanitizeHeader(v)}`);

  let body = rawHeaders.join('\r\n') + '\r\n\r\n';
  if (text) body += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n`;
  if (html) body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`;
  body += `--${boundary}--\r\n`;

  const bytes = new TextEncoder().encode(body);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const rawData = btoa(binary);

  const payload = { Content: { Raw: { Data: rawData } } };
  if (configurationSet) payload.ConfigurationSetName = configurationSet;

  const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`SES raw request failed (${res.status}): ${(errBody || '').slice(0, 200)}`);
  }
  const data = await res.json();
  return { messageId: data?.MessageId || null };
}

// List-Unsubscribe headers (RFC 8058 one-click) — mirrors _tracking.js unsubscribeHeaders.
function unsubscribeHeaders(unsubUrl) {
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// ---------------------------------------------------------------------------
// email_log insert (send mode only)
// ---------------------------------------------------------------------------

function logEmail({ event, email, source, detail }) {
  const esc = (s) => (s == null ? null : String(s).replace(/'/g, "''").slice(0, 500));
  const detailSql = detail == null ? 'NULL' : `'${esc(detail)}'`;
  const subjectSql = `'${SUBJECT.replace(/'/g, "''")}'`;
  d1(
    'rrm-auth',
    `INSERT INTO email_log (event, email, category, source, subject, detail)
     VALUES ('${event}', '${norm(email).replace(/'/g, "''")}', 'campaign', '${source}', ${subjectSql}, ${detailSql})`
  );
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\nBLOCKER: ${msg}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { awsKeyId, awsSecret, newsletterSecret } = resolveSecrets();

  console.log(`\n=== FemTech A/B sender — ${SEND ? 'SEND MODE (LIVE)' : 'DRY-RUN (default, no email, no DB writes)'} ===\n`);

  // UTM-leak assertion up front.
  const leaks = contentLinkUtmLeaks();

  const { finalList, counts } = buildCohort();
  const assignments = assignVariants(finalList);
  const aCount = assignments.filter((a) => a.variant === 'A').length;
  const bCount = assignments.filter((a) => a.variant === 'B').length;

  console.log('(1) Base cohort (survey, last 30 days, deduped):', counts.base);
  console.log('(2) Exclusions (overlap with base cohort):');
  console.log('      STUC members           :', counts.excl_stuc);
  console.log('      femtech-mvp waitlist    :', counts.excl_femtech);
  console.log('      hard excludes           :', counts.excl_hard);
  console.log('      suppression-tagged      :', counts.excl_suppression_tag);
  console.log('      email_log unsubscribed  :', counts.excl_unsubscribed_log);
  console.log('(3) Final deduped recipients :', counts.final);
  console.log('(4) Variant split            : A =', aCount, '| B =', bCount);
  console.log('(6) Content-link UTM params  :', leaks.length === 0 ? '0 (clean)' : `${leaks.length} LEAK(S): ${leaks.join('; ')}`);

  // (5) One fully-rendered sample of each variant with a REAL minted unsubscribe URL.
  const sampleA = assignments.find((a) => a.variant === 'A')?.email;
  const sampleB = assignments.find((a) => a.variant === 'B')?.email;

  console.log('\n(5) Rendered samples (real minted unsubscribe URLs):');
  console.log(`\nSubject (both variants): ${SUBJECT}`);
  console.log(`From: ${FROM}`);
  console.log(`Reply-To: ${REPLY_TO}\n`);

  if (sampleA) {
    const r = renderHtml('A', sampleA, newsletterSecret);
    console.log('----- VARIANT A -----');
    console.log(`To (sample recipient): ${sampleA}`);
    console.log(`Unsubscribe URL: ${r.unsubUrl}`);
    console.log('--- HTML ---');
    console.log(r.html);
    console.log('--- TEXT ---');
    console.log(r.text);
  } else {
    console.log('----- VARIANT A ----- (no recipients)');
  }

  if (sampleB) {
    const r = renderHtml('B', sampleB, newsletterSecret);
    console.log('\n----- VARIANT B -----');
    console.log(`To (sample recipient): ${sampleB}`);
    console.log(`Unsubscribe URL: ${r.unsubUrl}`);
    console.log('--- HTML ---');
    console.log(r.html);
    console.log('--- TEXT ---');
    console.log(r.text);
  } else {
    console.log('\n----- VARIANT B ----- (no recipients)');
  }

  if (!SEND) {
    console.log('\n=== DRY-RUN complete. No email sent, nothing written to D1. Re-run with --send to deliver. ===\n');
    if (leaks.length > 0) fail('Refusing readiness: content links carry UTM/tracking params.');
    return;
  }

  // ---- SEND MODE ----
  if (leaks.length > 0) fail('Refusing to send: content links carry UTM/tracking params.');

  const { aws, region } = makeAwsClient(awsKeyId, awsSecret);
  console.log(`\nSending ${assignments.length} emails via SES (region ${region}) in batches of ${BATCH_SIZE}, ${BATCH_DELAY_MS}ms between batches...\n`);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
    const batch = assignments.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ email, variant }) => {
        const source = `femtech-ab/${variant}`;
        const { html, text, unsubUrl } = renderHtml(variant, email, newsletterSecret);
        try {
          await sendRawEmail(aws, region, {
            from: FROM,
            to: email,
            subject: SUBJECT,
            html,
            text,
            replyTo: REPLY_TO,
            headers: unsubscribeHeaders(unsubUrl),
            configurationSet: CONFIGURATION_SET,
          });
          logEmail({ event: 'sent', email, source });
          return { email, variant, ok: true };
        } catch (err) {
          // On failure, log event='failed' with the same source and continue.
          try {
            logEmail({ event: 'failed', email, source, detail: err.message });
          } catch (_e) { /* best-effort */ }
          return { email, variant, ok: false, error: err.message };
        }
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        sent++;
        console.log(`  sent  [${r.value.variant}] ${r.value.email}`);
      } else {
        failed++;
        const v = r.status === 'fulfilled' ? r.value : { email: '?', variant: '?', error: r.reason?.message };
        console.log(`  FAIL  [${v.variant}] ${v.email}: ${v.error}`);
      }
    }

    if (i + BATCH_SIZE < assignments.length) await sleep(BATCH_DELAY_MS);
  }

  console.log(`\n=== SEND complete. sent=${sent} failed=${failed} total=${assignments.length} ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
