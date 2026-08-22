#!/usr/bin/env node
/**
 * test-gated-content.mjs — live persona × course access-gating matrix.
 *
 * Proves the enroll endpoint gives every class of visitor the response the
 * course's D1 config says they should get. Born 2026-08-22 from the
 * breaking-up-with-ivf incident: a members course with is_free=0 dead-ended
 * every fresh member with "Course pricing not configured", and nothing caught
 * it because existing enrollments (the idempotent branch) masked it for the
 * accounts we test with by hand.
 *
 * Personas (seeded idempotently in D1 rrm-auth; emails match the
 * administrator+test-* guard in enroll.js, so their enrollments fire neither
 * the admin-notify email nor GA4 events):
 *
 *   anonymous  no session cookie
 *   free       verified account, no membership signals
 *   member     verified account + 'STUC Legacy Grandfather' label (the
 *              deliberately-maintained allowlist mechanism — no Stripe needed)
 *   lapsed     verified account + the sticky legacy 'Save the Uterus Club 🏷️'
 *              label ONLY (the 2026-06-03 leak class) — must be DENIED
 *   staff      verified account with role 'mod'
 *
 * Expected outcome per (persona, course), derived from the same flags
 * enroll.js branches on:
 *
 *   anonymous            -> 401 everywhere
 *   members course       -> member/staff: enrolled  |  free/lapsed: 403
 *   public free course   -> any logged-in persona: enrolled
 *   public paid course   -> any logged-in persona: checkoutUrl (Stripe
 *                           sessions expire unpaid in 24h; harmless)
 *   comingSoon (non-members) -> 400 for logged-in personas
 *
 * Any 5xx, or any "pricing not configured" / "Payments not configured", fails
 * the run regardless of expectation.
 *
 * State hygiene: test enrollments are DELETEd before AND after the run (a
 * leftover enrollment would route through the idempotent branch and mask
 * exactly the bug class this exists to catch — the same masking that hid the
 * 2026-08-22 incident). Sessions are minted fresh per run (1h expiry) and
 * deleted after.
 *
 * Usage:
 *   node scripts/test-gated-content.mjs            # full matrix vs production
 *   node scripts/test-gated-content.mjs --keep     # skip post-run cleanup
 *
 * Needs CLOUDFLARE_API_TOKEN with D1 write on rrm-auth (falls back to
 * `op read 'op://Automation/CF - D1 Operator - account/credential'`).
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const SITE = 'https://rrmacademy.org';
const D1_NAME = 'rrm-auth';
const KEEP = process.argv.includes('--keep');

// Fixed ids so seeding is idempotent across runs and machines.
const PERSONAS = {
  free:   { id: 'a11111111111111111111111gatetest', role: 'member', labels: [] },
  member: { id: 'a22222222222222222222222gatetest', role: 'member', labels: ['STUC Legacy Grandfather'] },
  lapsed: { id: 'a33333333333333333333333gatetest', role: 'member', labels: ['Save the Uterus Club \u{1F3F7}\u{FE0F}'] },
  staff:  { id: 'a44444444444444444444444gatetest', role: 'mod', labels: [] },
};
const TEST_IDS = Object.values(PERSONAS).map(p => p.id);
const emailFor = (name) => `administrator+test-gate-${name}@rrmacademy.org`;

// Valid-shape, unusable password hash (random salt+hash; no plaintext exists).
// Personas authenticate via directly-minted sessions, never via /login.
const unusableHash = () =>
  `100000$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;

function d1(sql) {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    process.env.CLOUDFLARE_API_TOKEN = execFileSync(
      'op', ['read', 'op://Automation/CF - D1 Operator - account/credential'],
      { encoding: 'utf-8' }
    ).trim();
  }
  const raw = execFileSync(
    'npx', ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', `--command=${sql}`],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const start = raw.indexOf('[');
  if (start === -1) throw new Error(`no JSON in wrangler output: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(raw.slice(start));
  // Assert the envelope — an empty default here is a parser bug, not a result.
  if (!Array.isArray(parsed) || !parsed.every(r => r.success)) {
    throw new Error(`d1 query failed: ${raw.slice(0, 300)}`);
  }
  return parsed.map(r => r.results);
}

const sq = (s) => `'${s.replace(/'/g, "''")}'`;

function seed() {
  const stmts = [];
  for (const [name, p] of Object.entries(PERSONAS)) {
    stmts.push(
      `INSERT OR IGNORE INTO user (id, email, email_verified, hashed_password, name, role, signup_source) ` +
      `VALUES (${sq(p.id)}, ${sq(emailFor(name))}, 1, ${sq(unusableHash())}, ${sq('Gating Test ' + name)}, ${sq(p.role)}, 'gating-test')`
    );
    for (const label of p.labels) {
      stmts.push(`INSERT OR IGNORE INTO user_label (user_id, label) VALUES (${sq(p.id)}, ${sq(label)})`);
    }
  }
  d1(stmts.join('; '));
}

function resetEnrollments() {
  d1(`DELETE FROM enrollment WHERE user_id IN (${TEST_IDS.map(sq).join(',')})`);
}

function mintSessions() {
  const cookies = {};
  const stmts = [];
  const expires = Math.floor(Date.now() / 1000) + 3600;
  for (const [name, p] of Object.entries(PERSONAS)) {
    const plain = randomBytes(25).toString('hex');
    const hashed = createHash('sha256').update(plain).digest('hex');
    cookies[name] = `session=${plain}`;
    stmts.push(`INSERT INTO session (id, user_id, expires_at) VALUES (${sq(hashed)}, ${sq(p.id)}, ${expires})`);
  }
  d1(stmts.join('; '));
  return cookies;
}

function cleanup() {
  resetEnrollments();
  d1(`DELETE FROM session WHERE user_id IN (${TEST_IDS.map(sq).join(',')})`);
}

function loadCourses() {
  const [rows] = d1(
    `SELECT id, access_type, is_free, stripe_price_id, coming_soon FROM course WHERE status = 'published'`
  );
  if (!rows.length) throw new Error('0 published courses — refusing to run matrix on empty set');
  return rows;
}

// Expected outcome classes: 'enrolled' | 'checkout' | 401 | 403 | 400
function expected(persona, c) {
  if (persona === 'anonymous') return 401;
  if (c.access_type === 'members') {
    if (c.is_free !== 1) return 'MISCONFIGURED'; // CS4 gate territory; matrix flags it too
    return (persona === 'member' || persona === 'staff') ? 'enrolled' : 403;
  }
  if (c.coming_soon) return 400;
  if (c.is_free === 1) return 'enrolled';
  return c.stripe_price_id ? 'checkout' : 'MISCONFIGURED';
}

async function probe(cookie, courseId) {
  const res = await fetch(`${SITE}/api/courses/enroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `gating-test-${randomBytes(8).toString('hex')}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ courseId }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* keep {} — classified below */ }
  return { status: res.status, body };
}

function classify(r) {
  if (r.status === 200 && r.body.ok && r.body.enrolled) return 'enrolled';
  if (r.status === 200 && r.body.ok && r.body.checkoutUrl) return 'checkout';
  return r.status;
}

// ---------- Run -----------------------------------------------------------
console.log('Seeding personas + resetting test enrollment state...');
seed();
resetEnrollments();
const cookies = mintSessions();
const courses = loadCourses();
console.log(`${courses.length} published courses × ${Object.keys(PERSONAS).length + 1} personas\n`);

let failures = 0;
try {
  for (const c of courses) {
    for (const persona of ['anonymous', ...Object.keys(PERSONAS)]) {
      const want = expected(persona, c);
      const r = await probe(persona === 'anonymous' ? null : cookies[persona], c.id);
      const got = classify(r);
      const err = String(r.body.error || '');

      let ok = got === want;
      // Hard failures regardless of expectation:
      if (r.status >= 500 || /pricing not configured|Payments not configured/i.test(err)) ok = false;
      if (want === 'MISCONFIGURED') ok = false;

      const mark = ok ? '\x1b[32mok\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m';
      if (!ok) failures++;
      console.log(`${mark} ${c.id.padEnd(36)} ${persona.padEnd(10)} want=${String(want).padEnd(9)} got=${got}${ok ? '' : `  (${r.status} ${err.slice(0, 80)})`}`);
    }
  }
} finally {
  if (!KEEP) {
    console.log('\nCleaning up test enrollments + sessions...');
    cleanup();
  } else {
    console.log('\n--keep: leaving test enrollments + sessions in place');
  }
}

if (failures) {
  console.error(`\ngated-content matrix FAILED: ${failures} mismatches`);
  process.exit(1);
}
console.log(`\ngated-content matrix OK — every persona got the expected response class`);
