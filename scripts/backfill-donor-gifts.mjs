#!/usr/bin/env node
// scripts/backfill-donor-gifts.mjs
// One-time donor_gift backfill. Modes (combine; order matters: wix/stripe/paypal -> legacy-snapshot -> recompute):
//   --wix-d1 | --wix-csv <path> | --stripe | --paypal | --legacy-snapshot | --recompute | --verify-2025
//   --apply  actually run wrangler on the emitted SQL (default: emit only to /tmp/donor-backfill)
// Conventions binding per migrations/030-donor-gift.sql: ON CONFLICT(source, source_id) DO NOTHING,
// occurred_at ISO-8601 T+Z, deterministic ids for re-runnable modes.
// Rollup/stage logic imported from the canonical helper so it cannot drift.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deriveStage } from '../functions/api/billing/_donor-gift.js';

const OUT = '/tmp/donor-backfill';
const WIX_OK_STATUSES = ['PAID']; // observed 2026-06-11: only status in wix_payment (384 rows)
const DONATION_KINDS = `('one_time','recurring','membership')`;
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argAfter = (f) => args[args.indexOf(f) + 1];
const q = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
mkdirSync(OUT, { recursive: true });

// Mirrors generate_receipts.py (bookkeeping-2025) so verify-2025 compares like for like.
const EMAIL_MERGE = {
  'restorativereproductivemed@gmail.com': 'brianrwhittaker@gmail.com',
  'amanda@ascendptspokane.com': 'amanda@ascendpelvichealth.co',
};
const canonical = (e) => EMAIL_MERGE[e.toLowerCase()] || e.toLowerCase();

// V8-safe UTC normalization (mirrors toIsoUtc in _donor-gift.js).
function toIsoUtc(value) {
  let s = value;
  if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
    s = value.replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(value) ? '' : 'Z');
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function d1(cmd, file = null) {
  const base = ['wrangler', 'd1', 'execute', 'rrm-auth', '--remote', '--json'];
  const full = file ? [...base, `--file=${file}`] : [...base, `--command=${cmd}`];
  const out = execFileSync('npx', full, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // --file mode prints progress lines ("├ Checking...") before the JSON; skip to the JSON array.
  const jsonStart = out.search(/^\[$|^\[\{/m);
  if (jsonStart === -1) throw new Error(`no JSON in wrangler output: ${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(jsonStart));
  if (parsed[0]?.success !== true || !Array.isArray(parsed[0]?.results)) throw new Error('unexpected wrangler d1 result envelope; refusing to treat as empty');
  return parsed[0].results;
}

function emitAndMaybeApply(name, statements) {
  const files = [];
  for (let i = 0; i < statements.length; i += 200) {
    const f = `${OUT}/${name}-${String(i / 200).padStart(3, '0')}.sql`;
    writeFileSync(f, statements.slice(i, i + 200).join('\n'));
    files.push(f);
  }
  console.log(`${name}: ${statements.length} statements in ${files.length} file(s) under ${OUT}/`);
  if (has('--apply')) for (const f of files) { console.log(`applying ${f}`); d1(null, f); }
}

function giftInsert(g) {
  const occurredAt = toIsoUtc(g.occurredAt);
  if (!occurredAt) throw new Error(`bad occurred_at for ${g.sourceId}: ${g.occurredAt}`);
  return `INSERT INTO donor_gift (id, email, display_name, amount_cents, currency, source, source_id, entity, kind, ppgf, occurred_at, receipt_year)
VALUES (${q(g.id)}, ${q(g.email)}, ${q(g.displayName)}, ${g.amountCents}, ${q(g.currency || 'USD')}, ${q(g.source)}, ${q(g.sourceId)}, 'foundation', ${q(g.kind)}, ${g.ppgf ? 1 : 0}, ${q(occurredAt)}, ${new Date(occurredAt).getUTCFullYear()})
ON CONFLICT(source, source_id) DO NOTHING;`;
}

// ---------- --wix-d1 ----------
if (has('--wix-d1')) {
  const inList = WIX_OK_STATUSES.map(q).join(',');
  emitAndMaybeApply('wix-d1', [
`INSERT INTO donor_gift (id, email, display_name, amount_cents, currency, source, source_id, entity, kind, ppgf, occurred_at, receipt_year, contact_id)
SELECT 'dg_wix_' || wp.wix_order_id, wp.email,
       NULLIF(TRIM(COALESCE(ws.first_name,'') || ' ' || COALESCE(ws.last_name,'')), ''),
       wp.amount_cents, wp.currency, 'wix', wp.wix_order_id, 'foundation',
       CASE WHEN wp.wix_subscription_id IS NOT NULL THEN 'membership'
            WHEN wp.is_donation = 1 THEN 'one_time' ELSE 'course' END,
       0, strftime('%Y-%m-%dT%H:%M:%fZ', wp.paid_at), CAST(strftime('%Y', wp.paid_at) AS INTEGER), wp.contact_id
FROM wix_payment wp
LEFT JOIN wix_subscription ws ON ws.wix_subscription_id = wp.wix_subscription_id
WHERE wp.payment_status IN (${inList}) AND wp.amount_cents > 0
ON CONFLICT(source, source_id) DO NOTHING;`,
  ]);
}

// ---------- --wix-csv ---------- (quoted-field-aware: billing addresses contain commas)
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
if (has('--wix-csv')) {
  // CSV dates are ET-local and the synthetic ids bake in local parsing; running on a
  // non-Eastern machine regenerates different source_ids AND defeats the 2h dedupe.
  const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolvedTz !== 'America/New_York') {
    console.error(`--wix-csv must run with TZ=America/New_York (resolved: ${resolvedTz}); re-run as: TZ=America/New_York node scripts/backfill-donor-gifts.mjs ...`);
    process.exit(1);
  }
  const raw = readFileSync(argAfter('--wix-csv'), 'utf8');
  const rows = raw.split('\n').slice(1).filter(Boolean).map(parseCsvLine);
  // Dedupe against rows --wix-d1 already inserted: the two modes use different source_id
  // schemes (wix_order_id vs csv:...), so ON CONFLICT cannot catch the overlap. Match on
  // canonical email + cents + occurred_at within 2h (observed skew vs wix_payment.paid_at
  // is seconds; 2h absorbs any DST/fixed-offset export quirk), consuming each D1 row once.
  // Canonical email matters: one donor's subscription email changed mid-2025 (EMAIL_MERGE).
  const DEDUPE_TOL_MS = 2 * 3600e3;
  const existing = new Map(); // `${canonicalEmail}|${cents}` -> [{ms, used}]
  for (const r of d1(`SELECT email, amount_cents, occurred_at FROM donor_gift WHERE source = 'wix'`)) {
    const k = `${canonical(r.email)}|${r.amount_cents}`;
    if (!existing.has(k)) existing.set(k, []);
    existing.get(k).push({ ms: Date.parse(r.occurred_at), used: false });
  }
  if (existing.size === 0) {
    const wixCount = d1(`SELECT COUNT(*) n FROM donor_gift WHERE source='wix'`)[0]?.n ?? 0;
    if (wixCount > 0) {
      console.error(`dedupe pre-pass returned 0 wix rows but donor_gift has ${wixCount} wix rows; envelope changed or query silently failed. Aborting.`);
      process.exit(1);
    }
  }
  let skippedDupes = 0;
  const stmts = [];
  for (const c of rows) {
    if ((c[8] || '').trim() !== 'Successful') continue;
    const dt = new Date((c[0] || '').trim());   // 'MM/DD/YYYY, hh:mm:ss AM' parses as local (ET business data; acceptable)
    if (Number.isNaN(+dt)) continue;
    const amount = parseFloat((c[4] || '').trim());
    const email = (c[26] || '').trim().toLowerCase();
    if (!email || !(amount > 0)) continue;
    const cands = (existing.get(`${canonical(email)}|${Math.round(amount * 100)}`) || [])
      .filter((x) => !x.used && Math.abs(x.ms - +dt) <= DEDUPE_TOL_MS);
    if (cands.length) {
      cands.reduce((a, b) => Math.abs(a.ms - +dt) <= Math.abs(b.ms - +dt) ? a : b).used = true;
      skippedDupes++;
      continue;
    }
    const product = (c[45] || '').trim();
    const kind = /membership|save the uterus/i.test(product) ? 'membership'
      : /masterclass|ltem|endometriosis/i.test(product) ? 'course' : 'one_time';
    stmts.push(giftInsert({
      id: `dg_wixcsv_${dt.toISOString()}_${email}_${Math.round(amount * 100)}`.replace(/[^a-zA-Z0-9_@.:-]/g, '_'),
      email, displayName: `${(c[16] || '').trim()} ${(c[17] || '').trim()}`.trim() || null,
      amountCents: Math.round(amount * 100), source: 'wix',
      sourceId: `csv:${dt.toISOString()}:${email}:${Math.round(amount * 100)}`,
      kind, occurredAt: dt.toISOString(),
    }));
  }
  console.log(`wix-csv: ${skippedDupes} rows skipped as dupes of existing wix gifts`);
  emitAndMaybeApply('wix-csv', stmts);
}

// ---------- --stripe ----------
if (has('--stripe')) {
  const key = process.env.STRIPE_KEY;
  if (!key) { console.error('STRIPE_KEY env required (read-only restricted key)'); process.exit(1); }
  const since = Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000);
  const stmts = [];
  let starting_after = '';
  for (;;) {
    const url = `https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}${starting_after ? `&starting_after=${starting_after}` : ''}`;
    const page = await fetch(url, { headers: { Authorization: `Bearer ${key}` } }).then((r) => r.json());
    if (page.error) { console.error('stripe error:', page.error.message); process.exit(1); }
    for (const ch of page.data) {
      if (ch.status !== 'succeeded' || !ch.paid || ch.refunded) continue;
      const hay = `${ch.calculated_statement_descriptor || ''} ${ch.description || ''} ${ch.metadata?.type || ''}`;
      // Mirrors rrm-finance-sync STRIPE_RULES classification order.
      const kind = /stuc|membership|save the uterus|subscription/i.test(hay) || ch.invoice ? 'membership'
        : /masterclass|course/i.test(hay) ? 'course' : 'one_time';
      const email = (ch.billing_details?.email || ch.receipt_email || '').toLowerCase();
      if (!email) { console.warn(`UNATTRIBUTABLE stripe charge ${ch.id} $${ch.amount / 100} ${new Date(ch.created * 1000).toISOString()}`); continue; }
      stmts.push(giftInsert({
        id: `dg_${ch.payment_intent || ch.id}`, email,
        displayName: ch.billing_details?.name || null, amountCents: ch.amount, currency: (ch.currency || 'usd').toUpperCase(),
        source: 'stripe', sourceId: ch.payment_intent || ch.id, kind,
        occurredAt: new Date(ch.created * 1000).toISOString(),
      }));
    }
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  emitAndMaybeApply('stripe', stmts);
}

// ---------- --paypal ----------
if (has('--paypal')) {
  const { PAYPAL_CLIENT_ID: cid, PAYPAL_CLIENT_SECRET: sec } = process.env;
  if (!cid || !sec) { console.error('PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET env required'); process.exit(1); }
  const tok = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${cid}:${sec}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }).then((r) => r.json());
  if (!tok.access_token) { console.error('paypal oauth failed'); process.exit(1); }
  const stmts = [];
  // Reports API caps each query at 31 days; walk month windows from 2024-01 (UTC month boundaries).
  for (let d = new Date(Date.UTC(2024, 0, 1)); d < new Date(); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const end = new Date(Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), Date.now()));
    for (let pageN = 1; ; pageN++) {
      const u = `https://api-m.paypal.com/v1/reporting/transactions?start_date=${d.toISOString()}&end_date=${end.toISOString()}&fields=transaction_info,payer_info&page_size=100&page=${pageN}`;
      const res = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
      for (const t of res.transaction_details || []) {
        const info = t.transaction_info;
        if (info.transaction_event_code !== 'T0006' || info.transaction_status !== 'S') continue;
        const amount = parseFloat(info.transaction_amount?.value || '0');
        if (!(amount > 0)) continue;
        const pn = t.payer_info?.payer_name;
        const name = pn?.alternate_full_name || [pn?.given_name, pn?.surname].filter(Boolean).join(' ') || '';
        const email = (t.payer_info?.email_address || '').toLowerCase();
        const ppgf = /giving\s*fund/i.test(name) || /givingfund|@paypal\.com$/.test(email) ? 1 : 0;
        if (!email) { console.warn(`UNATTRIBUTABLE paypal donation ${info.transaction_id} $${amount} ${info.transaction_initiation_date}`); continue; }
        stmts.push(giftInsert({
          id: `dg_pp_${info.transaction_id}`, email, displayName: name || null,
          amountCents: Math.round(amount * 100), source: 'paypal', sourceId: info.transaction_id,
          kind: 'one_time', ppgf, occurredAt: info.transaction_initiation_date,
        }));
      }
      if (pageN >= (res.total_pages || 1)) break;
    }
  }
  emitAndMaybeApply('paypal', stmts);
}

// ---------- --legacy-snapshot ---------- (run AFTER wix/stripe/paypal, BEFORE recompute)
// contact.total_donated carries legacy (pre-2024 / SQSP-era) history not reconstructable from
// any API. Synthesize one source='manual' residual row per contact so recompute preserves it.
if (has('--legacy-snapshot')) {
  const existingLegacy = d1(`SELECT COUNT(*) n FROM donor_gift WHERE source_id LIKE 'legacy-total:%'`)[0]?.n ?? 0;
  if (existingLegacy > 0 && !has('--legacy-rerun')) {
    console.error(`legacy-snapshot already ran (${existingLegacy} rows). Residuals computed after other writers mutate total_donated can fabricate phantom gifts. Pass --legacy-rerun only if you understand this.`);
    process.exit(1);
  }
  const rows = d1(`SELECT c.email, c.total_donated, c.first_seen_at,
      COALESCE((SELECT SUM(g.amount_cents) FROM donor_gift g
        WHERE g.email = c.email COLLATE NOCASE AND g.refunded_at IS NULL AND g.kind IN ${DONATION_KINDS}), 0) AS gift_cents
    FROM contact c WHERE c.total_donated > 0`);
  const stmts = [];
  for (const r of rows) {
    const residual = Math.round(r.total_donated * 100) - r.gift_cents;
    if (residual <= 0) continue;
    stmts.push(giftInsert({
      id: `dg_legacy_${r.email.toLowerCase()}`, email: r.email.toLowerCase(), displayName: null,
      amountCents: residual, source: 'manual', sourceId: `legacy-total:${r.email.toLowerCase()}`,
      kind: 'one_time', occurredAt: toIsoUtc(r.first_seen_at) || '2023-12-31T00:00:00.000Z',
    }));
  }
  console.log(`legacy-snapshot: ${stmts.length} residual rows (donors whose legacy total exceeds reconstructed gifts)`);
  emitAndMaybeApply('legacy-snapshot', stmts);
}

// ---------- --recompute ---------- (aggregate WHERE must mirror AGGREGATE_SQL in _donor-gift.js)
if (has('--recompute')) {
  const aggs = d1(`SELECT email,
      COALESCE(SUM(amount_cents), 0) AS donated_cents,
      MIN(occurred_at) AS first_gift_at, MAX(occurred_at) AS last_gift_at, COUNT(*) AS gift_count,
      MAX(CASE WHEN kind IN ('recurring','membership') THEN occurred_at END) AS last_recurring_at
    FROM donor_gift
    WHERE refunded_at IS NULL AND kind IN ${DONATION_KINDS}
    GROUP BY lower(email)`);
  const stmts = [];
  for (const a of aggs) {
    const stage = deriveStage({ giftCount: a.gift_count, donatedCents: a.donated_cents || 0, lastRecurringAt: a.last_recurring_at });
    stmts.push(`INSERT INTO contact (id, email, source, first_seen_at) VALUES (lower(hex(randomblob(16))), ${q(a.email)}, 'donor-backfill', ${q(a.first_gift_at)}) ON CONFLICT(email) DO NOTHING;`);
    stmts.push(`UPDATE contact SET total_donated = ${(a.donated_cents || 0) / 100}, first_gift_at = ${q(a.first_gift_at)}, last_gift_at = ${q(a.last_gift_at)}, gift_count = ${a.gift_count}, donor_stage = ${q(stage)}, updated_at = datetime('now') WHERE email = ${q(a.email)} COLLATE NOCASE;`);
  }
  stmts.push(`UPDATE donor_gift SET contact_id = (SELECT id FROM contact c WHERE c.email = donor_gift.email COLLATE NOCASE) WHERE contact_id IS NULL;`);
  emitAndMaybeApply('recompute', stmts);
}

// ---------- --verify-2025 ----------
if (has('--verify-2025')) {
  // Absolute path: the script may run from a /tmp worktree, so repo-relative resolution is unsafe.
  const summary = JSON.parse(readFileSync(`${process.env.HOME}/iCode/projects/rrm-foundation/bookkeeping-2025/receipt_summary.json`, 'utf8'));
  const rows = d1(`SELECT email, SUM(amount_cents) cents, COUNT(*) n FROM donor_gift WHERE source = 'wix' AND receipt_year = 2025 GROUP BY lower(email)`);
  const byEmail = new Map();
  for (const r of rows) {
    const key = canonical(r.email);
    const cur = byEmail.get(key) || { cents: 0, n: 0 };
    byEmail.set(key, { cents: cur.cents + r.cents, n: cur.n + r.n });
  }
  let mismatches = 0;
  for (const donor of summary.donors) {
    const got = byEmail.get(canonical(donor.email));
    const wantCents = Math.round(donor.total * 100);
    if (!got) { console.error(`MISSING ${donor.email} ($${donor.total})`); mismatches++; }
    else if (got.cents !== wantCents) { console.error(`MISMATCH ${donor.email}: D1 $${got.cents / 100} vs receipted $${donor.total}`); mismatches++; }
  }
  const totalCents = [...byEmail.values()].reduce((s, v) => s + v.cents, 0);
  console.log(`donors matched: ${summary.donor_count - mismatches}/${summary.donor_count}; D1 wix-2025 total $${totalCents / 100} vs receipted $${summary.total_receipted}`);
  process.exit(mismatches === 0 ? 0 : 1);
}
