#!/usr/bin/env node
/**
 * One-off trickle sender — "Excepted Fertility Benefits" public-comment drive.
 *
 * *** SUPERSEDED 2026-07-11: this campaign ALREADY SHIPPED via the Workspace
 * *** lane (community@rrmacademy.org drip, 41/41 sent). The SES lane is
 * *** deprecated for community updates (lands in Gmail Promotions; see memory
 * *** workspace-lane-for-community-updates). --send hard-refuses. Kept as the
 * *** corrected SES pattern reference alongside femtech-ab-send.mjs.
 *
 * Opt-out is REPLY-BASED (no one-click List-Unsubscribe header, no footer click
 * link) per Brian's instruction: the one-click header drove excessive unsubs.
 * Reply-To is a monitored human address; footer tells recipients to just reply.
 * CAN-SPAM postal address is retained (still required).
 *
 *   node scripts/fertility-rule-comment-send.mjs                 # dry-run (safe)
 *   node scripts/fertility-rule-comment-send.mjs --to=you@x.com  # send ONE test
 *   node scripts/fertility-rule-comment-send.mjs --send          # trickle to full list
 */

import { AwsClient } from 'aws4fetch';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const SEND = process.argv.includes('--send');
const TEST_TO = (process.argv.find((a) => a.startsWith('--to=')) || '').split('=')[1] || null;

const FROM = '"RRM Academy" <newsletter@mail.rrmacademy.org>';
const REPLY_TO = 'community@rrmacademy.org';
const SUBJECT = 'Help shape what fertility benefits cover, by July 13';
const CONFIGURATION_SET = 'rrm-email';
const CATEGORY = 'campaign';
const SOURCE = 'fertility-rule-comment-drive';

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 4000;

const POSTAL_ADDRESS =
  'RRM Academy, a program of Restorative Reproductive Medicine Foundation Inc. | 3401 Hartzdale Dr, Ste 103B PMB 3518, Camp Hill, PA 17011';

const HARD_EXCLUDES = [
  'brianrwhittaker@gmail.com', 'naomimwhittaker@gmail.com',
  'restorativereproductivemed@gmail.com', 'administrator@rrmacademy.org',
  'restorativereproductivemedicine@gmail.com',
].map((e) => e.toLowerCase());

const SUPPRESSION_TAGS = [
  'wix:unsubscribed', 'wix:bounced', 'email:bounced', 'email:complained',
  'elv:spamtrap', 'elv:invalid', 'elv:disposable', 'elv:dead_server',
  'elv:email_disabled', 'elv:antispam_system', 'elv:invalid_mx',
];

const BODY = `<p>Your voice can help shape what fertility benefits cover, and there's a short window to use it.</p>
<p>A new federal rule is open for public comment through July 13. Most coverage calls it an IVF rule, but it's broader than that. It also covers root-cause diagnosis, surgery, hormone testing, and fertility awareness-based methods. Whether patients ever hear about those options depends partly on who speaks up before the window closes.</p>
<p>Here's what the rule does and how to comment. It's quick:</p>
<p><strong><a href="https://rrmacademy.org/commentary/excepted-fertility-benefits-rule-comment-july-13/">The Excepted Fertility Benefits Rule Needs Your Comment by July 13</a></strong></p>
<p>If root-cause, restorative fertility care matters to you, this is a short, concrete way to be heard.</p>
<p>RRM Academy</p>`;

// --------------------------------------------------------------------------- helpers
function fail(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }
const norm = (e) => String(e || '').trim().toLowerCase();
const sqlList = (arr) => arr.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(',');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function opItemField(title, vault, field) {
  return execFileSync('op', ['item', 'get', title, '--vault', vault, '--fields', field, '--reveal'], { encoding: 'utf8' }).trim();
}
function opRead(ref) { return execFileSync('op', ['read', ref], { encoding: 'utf8' }).trim(); }

function resolveCfEnv() {
  const env = { ...process.env };
  if (!env.CLOUDFLARE_API_TOKEN) env.CLOUDFLARE_API_TOKEN = opRead('op://Automation/CF - Worker Deploy - account/credential');
  if (!env.CLOUDFLARE_ACCOUNT_ID) env.CLOUDFLARE_ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
  return env;
}
const CF_ENV = resolveCfEnv();

function d1(db, sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', env: CF_ENV, maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`wrangler returned no JSON for: ${sql.slice(0, 80)}`);
  return JSON.parse(out.slice(start))[0]?.results ?? [];
}

// Reply-based opt-out: NO unsubscribe token/link. Footer = postal address + "reply to opt out".
function renderEmail() {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:600px;line-height:1.6;">
${BODY}
<p style="font-size:11px;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
${POSTAL_ADDRESS}<br>
Don't want emails like this? Just reply to this message and we'll take you off the list.
</p>
</div>`;
  const text = BODY.replace(/<[^>]+>/g, '').trim() +
    `\n\n---\n${POSTAL_ADDRESS}\nDon't want emails like this? Just reply and we'll take you off the list.`;
  return { html, text };
}

function utmLeaks() {
  const leaks = [];
  const re = /href="(https:\/\/rrmacademy\.org\/[^"]+)"/g;
  let m;
  while ((m = re.exec(BODY)) !== null) if (/[?&](utm_|gclid|fbclid|mc_eid|mc_cid|ref=)/i.test(m[1])) leaks.push(m[1]);
  return leaks;
}

// --------------------------------------------------------------------------- SES
function makeAws(id, secret) {
  const region = process.env.AWS_SES_REGION || 'us-east-1';
  return { aws: new AwsClient({ accessKeyId: id, secretAccessKey: secret, region, service: 'ses' }), region };
}
async function sesGet(aws, region, path) {
  const res = await aws.fetch(`https://email.${region}.amazonaws.com${path}`, { method: 'GET' });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}
function sanitizeHeader(v) {
  const s = String(v ?? '');
  if (/[\r\n\x00]/.test(s)) throw new Error('Header injection blocked');
  return s.slice(0, 998);
}
async function sendRaw(aws, region, { to, html, text }) {
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`;
  const messageId = `<${crypto.randomUUID()}@mail.rrmacademy.org>`;
  const headers = [
    `From: ${sanitizeHeader(FROM)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(SUBJECT)}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Precedence: bulk',
    `Reply-To: ${sanitizeHeader(REPLY_TO)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  let body = headers.join('\r\n') + '\r\n\r\n';
  body += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n`;
  body += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n`;
  body += `--${boundary}--\r\n`;
  const bytes = new TextEncoder().encode(body);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const payload = { Content: { Raw: { Data: btoa(bin) } }, ConfigurationSetName: CONFIGURATION_SET };
  const res = await aws.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`SES ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json())?.MessageId || null;
}

function logEmail(event, email, detail) {
  // Slice BEFORE quote-doubling (2026-07-11 review): slicing after can cut a
  // doubled '' in half, leaving unbalanced SQL.
  const esc = (s) => (s == null ? 'NULL' : `'${String(s).slice(0, 500).replace(/'/g, "''")}'`);
  d1('rrm-auth',
    `INSERT INTO email_log (event, email, category, source, subject, detail) VALUES ('${event}','${norm(email).replace(/'/g, "''")}','${CATEGORY}','${SOURCE}','${SUBJECT.replace(/'/g, "''")}',${esc(detail)})`);
}

// --------------------------------------------------------------------------- recipient list
function buildRecipients() {
  const website = d1('rrm-auth',
    `SELECT DISTINCT lower(email) email FROM newsletter_subscriber WHERE status='active' AND source='website' AND email LIKE '%@%'`)
    .map((r) => norm(r.email)).filter(Boolean);
  const donors = d1('rrm-auth',
    `SELECT DISTINCT lower(email) email FROM contact WHERE (gift_count>0 OR total_donated>0) AND accepts_marketing=1 AND email LIKE '%@%'`)
    .map((r) => norm(r.email)).filter(Boolean);
  const supTag = new Set(d1('rrm-auth',
    `SELECT DISTINCT lower(c.email) email FROM contact c JOIN contact_tag ct ON ct.contact_id=c.id
     WHERE ct.tag IN (${sqlList(SUPPRESSION_TAGS)}) AND c.email LIKE '%@%'`).map((r) => norm(r.email)));
  const logUnsub = new Set(d1('rrm-auth',
    `SELECT DISTINCT lower(email) email FROM email_log WHERE event IN ('unsubscribed','bounced','complained') AND email LIKE '%@%'`).map((r) => norm(r.email)));
  // Re-run + cross-lane idempotency (2026-07-11 review): exclude anyone already
  // sent this campaign by EITHER lane (this SES script's source, or the
  // Workspace drip that actually shipped it).
  const alreadySent = new Set(d1('rrm-auth',
    `SELECT DISTINCT lower(email) email FROM email_log WHERE event='sent' AND source IN ('${SOURCE}','fertility-rule-drip') AND email LIKE '%@%'`).map((r) => norm(r.email)));
  const hard = new Set(HARD_EXCLUDES);
  const union = [...new Set([...website, ...donors])];
  const excluded = { hard: 0, suppression_tag: 0, log_unsub_bounce: 0, already_sent: 0, bad_format: 0 };
  const final = [];
  for (const e of union) {
    if (hard.has(e)) { excluded.hard++; continue; }
    if (supTag.has(e)) { excluded.suppression_tag++; continue; }
    if (logUnsub.has(e)) { excluded.log_unsub_bounce++; continue; }
    if (alreadySent.has(e)) { excluded.already_sent++; continue; }
    if (!EMAIL_RE.test(e)) { excluded.bad_format++; continue; }
    final.push(e);
  }
  final.sort();
  return { website, donors, union, final, excluded };
}

async function preflight(aws, region) {
  console.log('PRE-FLIGHT CHECKS');
  const acct = await sesGet(aws, region, '/v2/email/account');
  if (acct.status !== 200) fail(`SES get-account failed (${acct.status}): ${acct.body}`);
  console.log(`  [${acct.body.SendingEnabled ? 'PASS' : 'FAIL'}] SES sending enabled: ${acct.body.SendingEnabled}`);
  console.log(`  [${acct.body.ProductionAccessEnabled ? 'PASS' : 'FAIL'}] Production access: ${acct.body.ProductionAccessEnabled}`);
  console.log(`  [info] 24h quota: ${acct.body.SendQuota?.SentLast24Hours}/${acct.body.SendQuota?.Max24HourSend} used`);
  if (!acct.body.SendingEnabled) fail('SES sending disabled.');
  if (!acct.body.ProductionAccessEnabled) fail('SES in SANDBOX.');
  const idn = await sesGet(aws, region, '/v2/email/identities/mail.rrmacademy.org');
  console.log(`  [${idn.body.VerifiedForSendingStatus ? 'PASS' : 'FAIL'}] domain verified: ${idn.body.VerifiedForSendingStatus}`);
  console.log(`  [${idn.body.DkimAttributes?.Status === 'SUCCESS' ? 'PASS' : 'WARN'}] DKIM: ${idn.body.DkimAttributes?.Status}`);
  if (!idn.body.VerifiedForSendingStatus) fail('domain not verified.');
  const cs = await sesGet(aws, region, `/v2/email/configuration-sets/${CONFIGURATION_SET}`);
  console.log(`  [${cs.status === 200 ? 'PASS' : 'FAIL'}] config set '${CONFIGURATION_SET}': ${cs.status === 200}`);
  if (cs.status !== 200) fail(`config set missing.`);
}

// --------------------------------------------------------------------------- main
(async () => {
  const mode = TEST_TO ? `TEST -> ${TEST_TO}` : SEND ? 'LIVE SEND' : 'DRY-RUN';
  console.log(`\n=== Fertility-rule comment-drive send (${mode}) ===\n`);
  console.log('OPT-OUT: reply-based (no one-click unsubscribe header/link)\n');

  const awsKeyId = opItemField('RRM AWS - IAM Access Key (rrm-ses-sender)', 'Automation', 'access key id');
  const awsSecret = opItemField('RRM AWS - IAM Access Key (rrm-ses-sender)', 'Automation', 'secret access key');
  if (!awsKeyId || !awsSecret) fail('AWS SES creds resolved empty.');
  const { aws, region } = makeAws(awsKeyId, awsSecret);
  await preflight(aws, region);

  const { html, text } = renderEmail();
  const leaks = utmLeaks();
  console.log(`\nCONTENT: [${leaks.length === 0 ? 'PASS' : 'FAIL'}] no UTM${leaks.length ? ': ' + leaks.join(',') : ''} | from: ${FROM} | reply-to: ${REPLY_TO}`);
  // Enforced, not just printed (2026-07-11 review): redirect-trackers and
  // pixels are banned in email; a leak here refuses the run before any send.
  if (leaks.length > 0) fail('Refusing: content links carry UTM/tracking params: ' + leaks.join(', '));

  // ---- TEST MODE: send one, no list, no campaign log
  if (TEST_TO) {
    if (!EMAIL_RE.test(TEST_TO)) fail(`--to address invalid: ${TEST_TO}`);
    console.log(`\n--- rendered HTML ---\n${html}\n--- rendered TEXT ---\n${text}\n`);
    const mid = await sendRaw(aws, region, { to: TEST_TO, html, text });
    console.log(`\n✅ TEST sent to ${TEST_TO} (SES MessageId: ${mid}). Not logged as campaign.\n`);
    process.exit(0);
  }

  // ---- Recipient list
  console.log('\nRECIPIENT LIST');
  const { website, donors, union, final, excluded } = buildRecipients();
  console.log(`  website:${website.length} donors:${donors.length} union:${union.length}`);
  console.log(`  excluded -> internal:${excluded.hard} suppression-tag:${excluded.suppression_tag} unsub/bounce:${excluded.log_unsub_bounce} already-sent:${excluded.already_sent} bad-format:${excluded.bad_format}`);
  let suppressed = [];
  for (const e of final) {
    // 200 = suppressed, 404 = clean; anything else (429/5xx) is retried once and
    // then fails the run -- treating a throttle as 'clean' would mail known
    // bounces (2026-07-11 review). ~100ms pacing keeps the probe under limits.
    let r = await sesGet(aws, region, `/v2/email/suppression/addresses/${encodeURIComponent(e)}`);
    if (r.status !== 200 && r.status !== 404) {
      await new Promise((res) => setTimeout(res, 500));
      r = await sesGet(aws, region, `/v2/email/suppression/addresses/${encodeURIComponent(e)}`);
    }
    if (r.status === 200) suppressed.push(e);
    else if (r.status !== 404) fail(`Suppression check unreliable for ${e} (HTTP ${r.status}); refusing to guess.`);
    await new Promise((res) => setTimeout(res, 100));
  }
  const clean = final.filter((e) => !suppressed.includes(e));
  console.log(`  SES suppression hits: ${suppressed.length}`);
  console.log(`  DELIVERABLE: ${clean.length}`);
  clean.forEach((e, i) => console.log(`    ${String(i + 1).padStart(2)}. ${e}`));

  if (!SEND) { console.log('\nDRY-RUN complete. No email sent. --to=you@x for a test, --send to trickle.\n'); process.exit(0); }

  fail('SUPERSEDED: this campaign shipped 2026-07-11 via the Workspace drip (community@, 41/41). The SES lane is deprecated for community updates (Gmail Promotions). See memory workspace-lane-for-community-updates.');

  // eslint-disable-next-line no-unreachable -- kept as the corrected SES pattern
  if (clean.length === 0) fail('No deliverable recipients.');
  console.log(`\nLIVE SEND: ${clean.length}, batches of ${BATCH_SIZE} every ${BATCH_DELAY_MS}ms\n`);
  let ok = 0, errs = 0;
  for (let i = 0; i < clean.length; i += BATCH_SIZE) {
    const batch = clean.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (email) => {
      const mid = await sendRaw(aws, region, { to: email, html, text });
      // Delivered. A D1 logging failure must never reclassify a delivered send
      // as failed (2026-07-11 review) -- warn and keep the recipient in 'sent'.
      try { logEmail('sent', email, mid); }
      catch (logErr) { console.log(`  WARN sent-but-unlogged ${email}: ${logErr.message}`); }
      return email;
    }));
    results.forEach((res, j) => {
      if (res.status === 'fulfilled') { ok++; console.log(`  sent -> ${batch[j]}`); }
      else { errs++; console.log(`  FAIL -> ${batch[j]}: ${res.reason?.message}`); try { logEmail('failed', batch[j], res.reason?.message); } catch {} }
    });
    if (i + BATCH_SIZE < clean.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  console.log(`\nSEND COMPLETE: ${ok} sent, ${errs} failed.\n`);
  if (errs > 0) process.exit(1);
})().catch((e) => fail(e.stack || e.message));
