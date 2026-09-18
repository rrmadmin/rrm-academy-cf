/**
 * Falsification harness for the payment-pipeline proof gates (PG0-PG4).
 *
 * The gate encodes 41 /arise findings across 13 runs on the Stripe surface, and
 * until 2026-09-18 nothing proved it still refused any of them: an edit that
 * weakened an assertion produced a green CI run. Each test here plants the exact
 * regression the corresponding assertion exists to catch and asserts the gate
 * goes RED and NAMES it. A gate nobody has watched fail is a decoration.
 *
 * Fixtures are COPIES of the real payment surface, mutated one regression at a
 * time. Two reasons: the clean case is then green by construction (so a gate
 * that fails everything cannot be mistaken for a working one), and the fixture
 * cannot drift out of sync with MIN_BILLING_MODULES / COVERAGE_SENTINELS /
 * NOT_A_WEBHOOK_HANDLER the way a hand-written tree would. If `the pristine
 * payment surface passes` is the only red test, the real repo is red, not this.
 *
 * No network, no D1, no Stripe. Static analysis over a temp directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(GATE_DIR, 'validate-payment-pipeline.mjs');
const REPO = join(GATE_DIR, '..', '..');

const WEBHOOK_ENTRY = 'functions/api/stripe-webhook.js';
const SHARED = 'functions/api/billing/_shared.js';
const TOP_LEVEL = [
  WEBHOOK_ENTRY,
  'functions/api/create-checkout.js',
  'functions/api/fund-progress.js',
  'functions/api/fund-supporters.js',
];

/** A copy of the real payment surface in a temp tree. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'payment-gate-'));
  mkdirSync(join(root, 'functions/api/billing'), { recursive: true });
  cpSync(join(REPO, 'functions/api/billing'), join(root, 'functions/api/billing'), { recursive: true });
  for (const f of TOP_LEVEL) cpSync(join(REPO, f), join(root, f));
  return root;
}

const clean = (root) => rmSync(root, { recursive: true, force: true });
const readF = (root, rel) => readFileSync(join(root, rel), 'utf8');
const writeF = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** Replace `find` with `repl` in a fixture file, asserting the anchor existed. */
function patch(root, rel, find, repl) {
  const src = readF(root, rel);
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find)} missing from ${rel}`);
  writeF(root, rel, src.split(find).join(repl));
}

function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json', ...args],
      { env: { ...process.env, PAYMENT_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** Run one gate and assert it went red naming `pattern`. */
function expectRed(root, gate, pattern) {
  const { code, out } = run(root, ['--gate', gate]);
  assert.equal(code, 1, `${gate} must REFUSE this fixture; it exited 0:\n${out}`);
  assert.match(out, pattern);
  return out;
}

function expectGreen(root, gate) {
  const { code, out } = run(root, ['--gate', gate]);
  assert.equal(code, 0, `${gate} must accept this fixture; got:\n${out}`);
  return out;
}

// ---------- baseline -------------------------------------------------------

test('the pristine payment surface passes all five gates', () => {
  const root = fixture();
  const { code, out } = run(root);
  assert.equal(code, 0, `a copy of the real surface must be green; got:\n${out}`);
  const report = JSON.parse(out);
  assert.deepEqual(report.gates.map((g) => g.id), ['PG0', 'PG1', 'PG2', 'PG3', 'PG4']);
  assert.ok(report.gates.every((g) => g.pass));
  clean(root);
});

test('PAYMENT_GATE_ROOT actually redirects the scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'payment-gate-empty-'));
  const { code, out } = run(root, ['--gate', 'PG0']);
  assert.equal(code, 1, 'an empty tree must not pass PG0');
  assert.match(out, /could not enumerate functions\/api\/billing/);
  clean(root);
});

// ---------- PG0: payment surface enumeration -------------------------------

test('PG0: a collapsed billing walk fails instead of reporting success over nothing', () => {
  const root = fixture();
  rmSync(join(root, 'functions/api/billing'), { recursive: true });
  mkdirSync(join(root, 'functions/api/billing'));
  writeF(root, 'functions/api/billing/_shared.js', '// lone survivor\n');
  expectRed(root, 'PG0', /enumerated only 1 modules, below floor/);
  clean(root);
});

test('PG0: a billing module in an extension the gates cannot read fails', () => {
  const root = fixture();
  // .cjs is exactly the hole the hand-maintained array produced once: a real
  // money-path module that every source-scanning gate silently skips.
  writeF(root, 'functions/api/billing/_webhook-payout.cjs', 'module.exports = {};\n');
  expectRed(root, 'PG0', /_webhook-payout\.cjs: in functions\/api\/billing but neither scannable/);
  clean(root);
});

test('PG0: a renamed top-level money file fails rather than vanishing from coverage', () => {
  const root = fixture();
  rmSync(join(root, 'functions/api/fund-progress.js'));
  expectRed(root, 'PG0', /fund-progress\.js listed in TOP_LEVEL_PAYMENT_FILES but not on disk/);
  clean(root);
});

test('PG0: dropping a coverage sentinel fails', () => {
  const root = fixture();
  // _donor-gift.js computes and INSERTs amount_cents. It was invisible to
  // PG2/PG3 for months; the sentinel exists so it can never go dark again.
  rmSync(join(root, 'functions/api/billing/_donor-gift.js'));
  expectRed(root, 'PG0', /_donor-gift\.js is a payment-surface sentinel but is not covered/);
  clean(root);
});

test('PG0: a stale NOT_A_WEBHOOK_HANDLER carve-out fails', () => {
  const root = fixture();
  rmSync(join(root, 'functions/api/billing/_webhook-shared.js'));
  expectRed(root, 'PG0', /NOT_A_WEBHOOK_HANDLER\['functions\/api\/billing\/_webhook-shared\.js'\] does not exist on disk/);
  clean(root);
});

test('PG0: an OS dropping in the billing directory does NOT fail the gate', () => {
  const root = fixture();
  writeF(root, 'functions/api/billing/.DS_Store', 'finder junk');
  expectGreen(root, 'PG0');
  clean(root);
});

// ---------- PG1: signature verify + dedup envelope -------------------------
// The two named in the gate's own comment, planted specifically.

test('PG1 THE REGRESSION: constructEvent instead of constructEventAsync fails twice', () => {
  const root = fixture();
  patch(root, WEBHOOK_ENTRY,
    'await stripe.webhooks.constructEventAsync(', 'stripe.webhooks.constructEvent(');
  const out = expectRed(root, 'PG1', /must use stripe\.webhooks\.constructEventAsync/);
  // Both halves must fire: the missing-async assertion AND the sync-present one.
  assert.match(out, /contains stripe\.webhooks\.constructEvent \(sync\)/);
  clean(root);
});

test('PG1: dropping signature verification entirely fails', () => {
  const root = fixture();
  patch(root, WEBHOOK_ENTRY,
    'await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET)',
    'JSON.parse(body)');
  expectRed(root, 'PG1', /must use stripe\.webhooks\.constructEventAsync/);
  clean(root);
});

test('PG1: not reading the stripe-signature header fails', () => {
  const root = fixture();
  patch(root, WEBHOOK_ENTRY, "request.headers.get('stripe-signature')", "request.headers.get('x-sig')");
  expectRed(root, 'PG1', /must read 'stripe-signature' header from request/);
  clean(root);
});

test('PG1 THE REGRESSION: losing the webhook_event dedup insert fails', () => {
  const root = fixture();
  // A plain INSERT is the realistic weakening: it still writes the row, so
  // nothing at runtime looks broken until Stripe replays an event.id.
  patch(root, SHARED, 'INSERT OR IGNORE INTO webhook_event', 'INSERT INTO webhook_event');
  expectRed(root, 'PG1', /must INSERT OR IGNORE INTO webhook_event before dispatching/);
  clean(root);
});

test('PG1: losing the dedup rollback on 5xx fails', () => {
  const root = fixture();
  // Without the DELETE, a transient sub-handler failure becomes permanent:
  // every Stripe retry is skipped as a duplicate of the attempt that failed.
  patch(root, SHARED, 'DELETE FROM webhook_event', 'UPDATE webhook_event SET abandoned = 1 -- was DELETE');
  expectRed(root, 'PG1', /must DELETE FROM webhook_event when sub-handler returns 5xx/);
  clean(root);
});

test('PG1: a sub-handler re-implementing dedup fails', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_webhook-refund.js';
  writeF(root, rel, readF(root, rel) +
    "\nawait db.prepare('INSERT OR IGNORE INTO webhook_event (event_id) VALUES (?)').bind(id).run();\n");
  expectRed(root, 'PG1', /_webhook-refund\.js re-implements webhook_event dedup/);
  clean(root);
});

test('PG1: dedup SQL living in the entrypoint instead of _shared.js still passes', () => {
  const root = fixture();
  // The gate scans entry + _shared as one surface on purpose (2026-05-15
  // decomposition). Moving the SQL back must not be read as a regression.
  patch(root, SHARED, 'INSERT OR IGNORE INTO webhook_event', 'INSERT INTO webhook_event');
  patch(root, SHARED, 'DELETE FROM webhook_event', 'UPDATE webhook_event SET x = 1 --');
  writeF(root, WEBHOOK_ENTRY, readF(root, WEBHOOK_ENTRY) +
    "\n// INSERT OR IGNORE INTO webhook_event / DELETE FROM webhook_event live here now\n");
  expectGreen(root, 'PG1');
  clean(root);
});

// ---------- PG2: no err.message leak to the client -------------------------

test('PG2 THE REGRESSION: err.message inside JSON.stringify fails', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_donor-gift.js';
  writeF(root, rel, readF(root, rel) +
    '\nconst r = new Response(JSON.stringify({ error: err.message }), { status: 500 });\n');
  expectRed(root, 'PG2', /_donor-gift\.js:\d+ — err\.message inside JSON\.stringify/);
  clean(root);
});

test('PG2: the leak is caught through nested parens, not just the flat case', () => {
  const root = fixture();
  const rel = 'functions/api/billing/supporter-badge.js';
  writeF(root, rel, readF(root, rel) +
    '\nJSON.stringify({ error: String(err.message).slice(0, 80) });\n');
  expectRed(root, 'PG2', /supporter-badge\.js:\d+ — err\.message inside JSON\.stringify/);
  clean(root);
});

test('PG2: err.message in a server-side log call is NOT flagged', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_donor-gift.js';
  writeF(root, rel, readF(root, rel) +
    "\nlog(env, waitUntil, 'gift', 'error', 'error', err.message, 0, 500);\n" +
    '\nconsole.error(err.message, error.message);\n' +
    '\nconst body = JSON.stringify({ error: \'service_error\' });\n');
  expectGreen(root, 'PG2');
  clean(root);
});

test('PG2 covers the whole enumerated surface, not only the webhook files', () => {
  const root = fixture();
  // status.js is one of the four billing modules the old hand-written array
  // never listed. The leak must be found there too.
  const rel = 'functions/api/billing/status.js';
  writeF(root, rel, readF(root, rel) + '\nJSON.stringify({ detail: error.message });\n');
  expectRed(root, 'PG2', /status\.js:\d+ — err\.message inside JSON\.stringify/);
  clean(root);
});

// ---------- PG3: enrollment revocation discipline --------------------------

test('PG3 THE REGRESSION: DELETE FROM enrollment fails', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_webhook-refund.js';
  writeF(root, rel, readF(root, rel) +
    "\nawait db.prepare('DELETE FROM enrollment WHERE user_id = ? AND course_id = ?').bind(u, c).run();\n");
  expectRed(root, 'PG3', /_webhook-refund\.js:\d+ — DELETE FROM enrollment forbidden/);
  clean(root);
});

test('PG3: FROM enrollment without a revoked_at filter fails', () => {
  const root = fixture();
  const rel = 'functions/api/billing/status.js';
  writeF(root, rel, readF(root, rel) +
    "\nconst e = await db.prepare('SELECT id FROM enrollment WHERE user_id = ?').bind(uid).first();\n");
  expectRed(root, 'PG3', /status\.js:\d+ — FROM enrollment without revoked_at IS NULL filter/);
  clean(root);
});

test('PG3: the same read WITH the revoked_at filter passes', () => {
  const root = fixture();
  const rel = 'functions/api/billing/status.js';
  writeF(root, rel, readF(root, rel) +
    "\nconst e = await db.prepare('SELECT id FROM enrollment WHERE user_id = ? AND revoked_at IS NULL').bind(uid).first();\n");
  expectGreen(root, 'PG3');
  clean(root);
});

test('PG3: the revocation UPDATE itself is not mistaken for an unfiltered read', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_webhook-refund.js';
  writeF(root, rel, readF(root, rel) +
    "\nawait db.prepare('UPDATE enrollment SET revoked_at = unixepoch() WHERE id IN (SELECT id FROM enrollment WHERE user_id = ?)').bind(u).run();\n");
  expectGreen(root, 'PG3');
  clean(root);
});

test('PG3: a commented-out DELETE FROM enrollment does not fail the gate', () => {
  const root = fixture();
  const rel = 'functions/api/billing/status.js';
  writeF(root, rel, readF(root, rel) + '\n// DELETE FROM enrollment was replaced by revoked_at\n');
  expectGreen(root, 'PG3');
  clean(root);
});

// ---------- PG4: atomicity heuristic ---------------------------------------
// PG4 is deliberately calibrated as a WARN, never a FAIL (see its header
// comment): the signal is "hand-review this file", not "this file is broken".
// So its teeth are the warn item, not the exit code, and these tests pin that
// on purpose -- if PG4 is ever promoted to a hard failure, the exit-code
// assertion below is what flags the change.

test('PG4: 5+ sequential .run() calls with no db.batch raises the atomicity warn', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_webhook-invoice.js';
  writeF(root, rel, readF(root, rel) +
    '\n' + "await db.prepare('INSERT INTO a VALUES (?)').bind(1).run();\n".repeat(5));
  const { code, out } = run(root, ['--gate', 'PG4']);
  assert.equal(code, 0, 'PG4 is a warn-only gate by design');
  const items = JSON.parse(out).gates[0].items;
  const w = items.find((i) => i.msg.includes('_webhook-invoice.js') && i.msg.includes('review for atomicity'));
  assert.ok(w, `expected an atomicity warn for _webhook-invoice.js; got:\n${out}`);
  assert.equal(w.ok, null, 'the atomicity signal must be a warn, not a pass');
  assert.match(w.msg, /5 sequential \.run\(\) calls and zero db\.batch\(\)/);
  clean(root);
});

test('PG4: the same writes wrapped in db.batch raise no warn', () => {
  const root = fixture();
  const rel = 'functions/api/billing/_webhook-invoice.js';
  writeF(root, rel, readF(root, rel) +
    '\nawait db.batch([s1, s2, s3, s4, s5]);\n' +
    "await db.prepare('INSERT INTO a VALUES (?)').bind(1).run();\n".repeat(5));
  const out = expectGreen(root, 'PG4');
  assert.ok(!JSON.parse(out).gates[0].items.some((i) => i.ok === null),
    `db.batch present: no atomicity warn expected; got:\n${out}`);
  clean(root);
});

test('PG4 walks every derived webhook sub-handler, not a hand-listed set', () => {
  const root = fixture();
  writeF(root, 'functions/api/billing/_webhook-payout.js',
    "export async function onRequest() {}\n" +
    "await db.prepare('INSERT INTO a VALUES (?)').bind(1).run();\n".repeat(6));
  const { out } = run(root, ['--gate', 'PG4']);
  assert.match(out, /_webhook-payout\.js has 6 sequential \.run\(\) calls/);
  clean(root);
});
