/**
 * Falsification harness for scripts/guard.mjs — the site's secret-scanning and
 * critical-file-tamper guard.
 *
 * guard.mjs calls itself self-guarding (its own sha256 is entry
 * "scripts/guard.mjs" in guard-manifest.json), but until PR #178 landed on
 * 2026-09-18 its own edits did not even trigger the workflow that runs it:
 * deploy.yml's `paths:` filter never listed it. #178 fixed the trigger. Nothing
 * proved the guard still REFUSES what it was written to refuse. This file plants
 * each regression the corresponding assertion exists to catch and asserts the
 * guard exits 1 and NAMES it. A guard nobody has watched fail is a decoration.
 *
 * Two inverse directions matter as much as the positive ones:
 *   - a secret scanner that fires on benign lookalikes gets bypassed, and a
 *     bypassed scanner is worse than none, so the benign cases are tested too;
 *   - PASS-only checks that are advisory BY DESIGN (the functions/api/billing
 *     file-count WARN) are pinned in their advisory state, never promoted.
 *
 * FIXTURES are copies of the real tree, mutated one regression at a time: the
 * clean case is then green by construction, so a guard that fails everything
 * cannot be mistaken for a working one, and the fixture cannot drift out of sync
 * with the 62 manifest hashes the way a hand-built tree would. If
 * `the pristine tree passes` is the only red test here, the real repo is red.
 *
 * ONE DELIBERATE DEPARTURE from a byte-exact copy: fixture() re-stamps the
 * manifest's own "scripts/guard.mjs" hash from the copied file. The teeth proof
 * for this harness edits guard.mjs itself; without the re-stamp every single
 * test would go red on the self-hash and the teeth table would read 100% green
 * while proving nothing. The self-hash entry keeps its own dedicated teeth test
 * below ("the manifest catches a tampered guard.mjs").
 *
 * All credential fixtures are obviously fake (AKIA/sk_test_ prefixes + EXAMPLE
 * filler) because the guard echoes a redacted prefix of any match it finds.
 *
 * No network. Static analysis over a temp directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'guard-manifest.json';

// Every tree the guard reads: the runtime dirs it scans for CORS/SQL/links, the
// wide dirs it secret-scans, public/_headers, and the root *.toml/*.json.
const COPY_DIRS = ['functions', 'src', 'scripts', '.github'];

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'guard-fx-'));
  for (const d of COPY_DIRS) cpSync(join(REPO, d), join(root, d), { recursive: true });
  mkdirSync(join(root, 'public'), { recursive: true });
  cpSync(join(REPO, 'public/_headers'), join(root, 'public/_headers'));
  for (const e of readdirSync(REPO, { withFileTypes: true })) {
    if (e.isFile() && /\.(toml|json)$/.test(e.name)) cpSync(join(REPO, e.name), join(root, e.name));
  }
  // See header: re-stamp the self-hash so the teeth proof's own edits to
  // guard.mjs cannot masquerade as this harness having teeth.
  const m = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  m.files['scripts/guard.mjs'].hash = sha256(join(root, 'scripts/guard.mjs'));
  writeFileSync(join(root, MANIFEST), JSON.stringify(m, null, 2) + '\n');
  return root;
}

const clean = (root) => rmSync(root, { recursive: true, force: true });
const readF = (root, rel) => readFileSync(join(root, rel), 'utf8');
const writeF = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const appendF = (root, rel, extra) => writeF(root, rel, readF(root, rel) + extra);

/** Replace `find` with `repl` in a fixture file, asserting the anchor existed. */
function patch(root, rel, find, repl) {
  const src = readF(root, rel);
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find)} missing from ${rel}`);
  writeF(root, rel, src.split(find).join(repl));
}

/**
 * Re-stamp a manifest hash after an INTENTIONAL fixture edit — what
 * `npm run guard:update` does in the repo. Only used by tests that expect green,
 * so that Phase 1 tamper detection (proved separately above) does not mask the
 * later-phase behaviour under test.
 */
function restamp(root, rel) {
  patchManifest(root, (m) => {
    assert.ok(m.files[rel], `${rel} is not a manifest entry; restamp is unnecessary`);
    m.files[rel].hash = sha256(join(root, rel));
  });
}

/** Rewrite one manifest entry via a mutator; returns nothing. */
function patchManifest(root, fn) {
  const m = JSON.parse(readF(root, MANIFEST));
  fn(m);
  writeF(root, MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// The script under test is always the REPO's guard.mjs, never the fixture's
// copy: the fixture supplies the tree, GUARD_ROOT supplies the redirect. That
// also lets the empty-tree test below run at all.
const GUARD = join(REPO, 'scripts/guard.mjs');

function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GUARD, ...args],
      { env: { ...process.env, GUARD_ROOT: root }, encoding: 'utf8' });
    return { code: 0, out: strip(out) };
  } catch (err) {
    return { code: err.status ?? 1, out: strip(`${err.stdout || ''}${err.stderr || ''}`) };
  }
}

/** Assert the guard REFUSED the fixture, naming `pattern`. */
function expectRed(root, pattern) {
  const { code, out } = run(root);
  assert.equal(code, 1, `guard must REFUSE this fixture; it exited 0:\n${out}`);
  assert.match(out, pattern);
  return out;
}

/** Assert the guard ACCEPTED the fixture (warnings are allowed: exit 0). */
function expectGreen(root) {
  const { code, out } = run(root);
  assert.equal(code, 0, `guard must accept this fixture; got:\n${out}`);
  return out;
}

// Obviously-fake credential fixtures. Shaped to match the guard's own regexes
// and nothing else; never copied from any real credential anywhere.
const FAKE = {
  awsKey: 'AKIA' + 'EXAMPLEEXAMPLE12',                       // AKIA + 16 [0-9A-Z]
  awsTemp: 'ASIA' + 'EXAMPLEEXAMPLE12',
  stripeTest: 'sk_test_' + 'EXAMPLEEXAMPLEEXAMPLE',          // 21 char tail
  stripeLive: 'sk_live_' + 'EXAMPLEEXAMPLEEXAMPLE',
  stripeRestricted: 'rk_live_' + 'EXAMPLEEXAMPLEEXAMPLE',
  webhookSecret: 'whsec_' + 'EXAMPLEEXAMPLEEXAMPLE',
  // Assembled from parts so the PEM armor never appears as a literal in
  // source. gitleaks' private-key rule fires on the armor alone, with no key
  // behind it -- the repo's own CLAUDE.md records this trap. The runtime
  // string is identical, so the guard still scans a real PEM header.
  privateKey: '-----BEGIN ' + 'PRIVATE KEY' + '-----',
  googleApi: 'AIzaSy' + 'EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMP', // 33 char tail
  googleOauth: 'GOCSPX-' + 'EXAMPLEEXAMPLEEXAMPLE',
  githubClassic: 'ghp_' + 'EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE1', // 36 char tail
  slack: 'xoxb-' + 'EXAMPLEEXAMPLEEXAMPLE',
  anthropic: 'sk-ant-' + 'EXAMPLEEXAMPLEEXAMPLE',
  openai: 'sk-proj-' + 'EXAMPLEEXAMPLEEXAMPLE',
  perplexity: 'pplx-' + 'EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLE',
  airtable: 'pat' + 'EXAMPLEEXAMPLE' + '.' + 'deadbeef'.repeat(8),
  bearer: 'Bearer ' + 'EXAMPLEEXAMPLEEXAMPLE',
};

// A scratch file in a runtime dir. Not in the manifest, so planting here
// exercises the scanner without also tripping Phase 1.
const RUNTIME_SCRATCH = 'functions/api/_guard-fixture-scratch.js';
const SCRIPTS_SCRATCH = 'scripts/_guard-fixture-scratch.mjs';

// ---------- baseline + the override itself ---------------------------------

test('the pristine tree passes the guard', () => {
  const root = fixture();
  const { code, out } = run(root);
  assert.equal(code, 0, `a copy of the real tree must be green; got:\n${out}`);
  assert.match(out, /ALL CLEAR/);
  assert.ok(!/ {2}FAIL/.test(out), `no FAIL lines expected; got:\n${out}`);
  clean(root);
});

test('GUARD_ROOT actually redirects the scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'guard-fx-empty-'));
  // An empty tree has no manifest at all; if GUARD_ROOT were ignored the guard
  // would read the real repo and pass.
  const { code, out } = run(root);
  assert.equal(code, 1, 'an empty tree must not pass');
  assert.match(out, /Cannot read .*guard-manifest\.json/);
  clean(root);
});

// ---------- Phase 1: hash integrity ---------------------------------------

test('Phase 1: a tampered guarded file fails on hash mismatch', () => {
  const root = fixture();
  // A one-line weakening of a real auth file: the kind of edit the manifest exists for.
  appendF(root, 'functions/api/auth/login.js', '\n// backdoor\n');
  expectRed(root, /FAIL {2}functions\/api\/auth\/login\.js — hash mismatch/);
  clean(root);
});

test('Phase 1: the manifest catches a tampered guard.mjs (self-guard has teeth)', () => {
  const root = fixture();
  appendF(root, 'scripts/guard.mjs', '\n// weakened\n');
  expectRed(root, /FAIL {2}scripts\/guard\.mjs — hash mismatch/);
  clean(root);
});

test('Phase 1: a guarded file deleted from disk fails, it does not silently skip', () => {
  const root = fixture();
  rmSync(join(root, 'functions/api/auth/forgot-password.js'));
  expectRed(root, /FAIL {2}functions\/api\/auth\/forgot-password\.js — file not found/);
  clean(root);
});

test('Phase 1: an unparseable manifest fails closed', () => {
  const root = fixture();
  writeF(root, MANIFEST, '{ "files": { truncated');
  expectRed(root, /Cannot read .*guard-manifest\.json/);
  clean(root);
});

test('Phase 1: a manifest hash edited to a wrong value fails', () => {
  const root = fixture();
  // Tampering the MANIFEST rather than the file: the guard must still refuse.
  patchManifest(root, (m) => { m.files['functions/api/auth/_shared.js'].hash = '0'.repeat(64); });
  expectRed(root, /FAIL {2}functions\/api\/auth\/_shared\.js — hash mismatch/);
  clean(root);
});

test('KNOWN GAP Phase 1: DELETING a manifest entry is invisible — guard stays green', () => {
  const root = fixture();
  // guard-manifest.json is not itself hashed (it cannot be: chicken-and-egg), so
  // an attacker who drops an entry AND weakens the file passes cleanly. Asserted
  // as the guard's ACTUAL behaviour, not promoted to a failure here: closing it
  // needs a manifest-entry floor, which is a guard change, not a test change.
  patchManifest(root, (m) => { delete m.files['functions/api/auth/login.js']; });
  appendF(root, 'functions/api/auth/login.js', '\n// unguarded now\n');
  const out = expectGreen(root);
  assert.ok(!/login\.js/.test(out.split('Phase 2')[0]),
    'login.js must be absent from Phase 1 entirely once its entry is gone');
  clean(root);
});

// ---------- Phase 2: security invariants ----------------------------------

test('Phase 2a: a changed CORS origin in _shared.js fails', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/_shared.js',
    "'Access-Control-Allow-Origin': 'https://rrmacademy.org'",
    "'Access-Control-Allow-Origin': 'https://rrmacademy.org.attacker.test'");
  const out = expectRed(root, /CORS origin in _shared\.js is NOT https:\/\/rrmacademy\.org/);
  // 2b must independently name the file and the bad origin.
  assert.match(out, /CORS origin in functions\/api\/auth\/_shared\.js is 'https:\/\/rrmacademy\.org\.attacker\.test'/);
  clean(root);
});

test('Phase 2b: a wildcard CORS origin anywhere under functions/ fails', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH,
    "export const onRequest = () => new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });\n");
  expectRed(root, /CORS origin in functions\/api\/_guard-fixture-scratch\.js is '\*'/);
  clean(root);
});

test('Phase 2c: swapping constructEventAsync for the sync call fails', () => {
  const root = fixture();
  patch(root, 'functions/api/stripe-webhook.js', 'constructEventAsync', 'constructEvent');
  expectRed(root, /stripe-webhook\.js missing 'constructEventAsync' call/);
  clean(root);
});

test('Phase 2c: not reading the stripe-signature header fails', () => {
  const root = fixture();
  patch(root, 'functions/api/stripe-webhook.js', 'stripe-signature', 'x-sig-header');
  expectRed(root, /stripe-webhook\.js missing 'stripe-signature' header check/);
  clean(root);
});

test('Phase 2d: losing the /community/ catch-all gate fails', () => {
  const root = fixture();
  patch(root, 'functions/_middleware.js', "startsWith('/community/')", "startsWith('/community/x')");
  expectRed(root, /_middleware\.js missing \/community\/ catch-all gate/);
  clean(root);
});

test('Phase 2d THE REGRESSION: a member-only sub-path leaking into the public carve-out fails', () => {
  const root = fixture();
  // The realistic weakening: someone "just makes events public too".
  patch(root, 'functions/_middleware.js',
    "pathnameLower === '/community/areas' ||",
    "pathnameLower === '/community/areas' ||\n    pathnameLower.startsWith('/community/events') ||");
  expectRed(root, /isPublicCommunity leaks a member-only sub-path \(events\/members\/post\)/);
  clean(root);
});

test('Phase 2d: dropping the isPublicCommunity carve-out entirely fails', () => {
  const root = fixture();
  patch(root, 'functions/_middleware.js', 'isPublicCommunity', 'isOpenCommunity');
  expectRed(root, /_middleware\.js missing isPublicCommunity carve-out/);
  clean(root);
});

test('Phase 2e: removing checkRateLimit from login.js fails', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/login.js', 'checkRateLimit', 'skipRateLimit');
  expectRed(root, /functions\/api\/auth\/login\.js missing checkRateLimit/);
  clean(root);
});

test('Phase 2e: removing checkRateLimit from signup.js fails', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/signup.js', 'checkRateLimit', 'skipRateLimit');
  expectRed(root, /functions\/api\/auth\/signup\.js missing checkRateLimit/);
  clean(root);
});

test('Phase 2f: google-callback losing the blocked-user check fails', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/google-callback.js', 'user.blocked', 'user.suspended');
  expectRed(root, /google-callback\.js missing user\.blocked check/);
  clean(root);
});

test('Phase 2f: google-callback losing isSafeRedirect fails (open redirect)', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/google-callback.js', 'isSafeRedirect', 'anyRedirect');
  expectRed(root, /google-callback\.js missing isSafeRedirect \(open redirect prevention\)/);
  clean(root);
});

test("Phase 2f: google-callback writing NULL instead of hashed_password = '' fails", () => {
  const root = fixture();
  patch(root, 'functions/api/auth/google-callback.js', "hashed_password = ''", 'hashed_password = NULL');
  expectRed(root, /google-callback\.js missing hashed_password = '' \(not NULL\)/);
  clean(root);
});

test('Phase 2g: upload.js losing its content-type allowlist fails', () => {
  const root = fixture();
  // The check is a loose /allowedTypes|image\/|content.type/i, so a realistic
  // kill has to remove all three spellings.
  const src = readF(root, 'functions/api/community/upload.js')
    .replace(/allowedTypes/g, 'anyTypes')
    .replace(/image\//g, 'img-')
    .replace(/content.type/gi, 'ctype');
  writeF(root, 'functions/api/community/upload.js', src);
  expectRed(root, /community\/upload\.js missing content-type allowlist check/);
  clean(root);
});

test('Phase 2h: /pagefind/* switched off no-store fails', () => {
  const root = fixture();
  patch(root, 'public/_headers', '/pagefind/*\n  Cache-Control: no-store',
    '/pagefind/*\n  Cache-Control: no-cache');
  expectRed(root, /\/pagefind\/\* must use no-store/);
  clean(root);
});

test('Phase 2h: /pagefind/* using stale-while-revalidate fails with its own message', () => {
  const root = fixture();
  patch(root, 'public/_headers', '/pagefind/*\n  Cache-Control: no-store',
    '/pagefind/*\n  Cache-Control: no-store, stale-while-revalidate=60');
  // no-store is still present, so only the SWR assertion can catch this.
  expectRed(root, /must not use stale-while-revalidate/);
  clean(root);
});

test('Phase 2h: a missing /pagefind/* section fails rather than passing over nothing', () => {
  const root = fixture();
  patch(root, 'public/_headers', '/pagefind/*', '/pagefind-disabled/*');
  expectRed(root, /public\/_headers missing \/pagefind\/\* section/);
  clean(root);
});

test('Phase 2i: google-callback losing escapeHtml fails (XSS)', () => {
  const root = fixture();
  patch(root, 'functions/api/auth/google-callback.js', 'escapeHtml', 'passThrough');
  expectRed(root, /google-callback\.js missing escapeHtml — XSS regression/);
  clean(root);
});

test('Phase 2i: community/index.astro losing &quot; in linkify fails (stored XSS)', () => {
  const root = fixture();
  patch(root, 'src/pages/community/index.astro', '&quot;', '"');
  expectRed(root, /community\/index\.astro missing &quot; in linkify/);
  clean(root);
});

// ---------- Phase 3: required files, floors, quiz content -----------------

test('Phase 3: a deleted required file is named with its note', () => {
  const root = fixture();
  rmSync(join(root, 'functions/api/survey/validate.js'));
  expectRed(root, /functions\/api\/survey\/validate\.js MISSING — Endo survey magic-link validation/);
  clean(root);
});

test('Phase 3: quizzes.json emptied to zero entries fails', () => {
  const root = fixture();
  writeF(root, 'src/data/quizzes.json', '{}\n');
  expectRed(root, /quizzes\.json has zero entries/);
  clean(root);
});

test('Phase 3: a quiz with an empty question array fails and is named', () => {
  const root = fixture();
  const q = JSON.parse(readF(root, 'src/data/quizzes.json'));
  const first = Object.keys(q)[0];
  q[first].questions = [];
  writeF(root, 'src/data/quizzes.json', JSON.stringify(q, null, 2));
  expectRed(root, new RegExp(`quizzes\\.json has empty question arrays: ${first}`));
  clean(root);
});

test('ADVISORY BY DESIGN Phase 3: a new billing file WARNs and does not block', () => {
  const root = fixture();
  // The real tree already sits one file over the floor (16 vs 15), so the WARN is
  // live today. This pins it as advisory: exit 0, WARN not FAIL. If the
  // file-count check is ever promoted to a hard failure, this test is the flag.
  writeF(root, 'functions/api/billing/_guard-fixture-new.js', 'export const onRequest = () => {};\n');
  const out = expectGreen(root);
  assert.match(out, /WARN {2}New file detected in functions\/api\/billing \(17 files, expected 15\)/);
  assert.ok(!/FAIL.*functions\/api\/billing \(17/.test(out), 'the file-count signal must stay a WARN');
  assert.match(out, /ALL CLEAR .* passed with 1 warning\(s\)/);
  clean(root);
});

test('Phase 3: an unreadable guarded directory is a hard FAIL, not a WARN', () => {
  // NOT INDEPENDENTLY FALSIFIABLE — named per the harness contract. Both
  // DIR_MINIMUMS directories are also fully manifest-guarded, so any fixture that
  // makes the directory unreadable simultaneously trips ~16 Phase 1 hash checks.
  // Removing the `failures++` beside "Cannot read directory" therefore leaves this
  // test green (teeth-proof row C5). It still pins that the guard REFUSES a
  // vanished billing directory and names it; it does not pin which check did so.
  const root = fixture();
  rmSync(join(root, 'functions/api/billing'), { recursive: true });
  const out = expectRed(root, /Cannot read directory functions\/api\/billing/);
  assert.ok(!/WARN {2}New file detected in functions\/api\/billing/.test(out),
    'a vanished directory must not be reported as the advisory file-count WARN');
  clean(root);
});

// ---------- Phase 4: secret scanning (positive) ---------------------------

test('Phase 4 THE POINT: every token pattern fires on a planted fake credential', () => {
  const cases = [
    ['Stripe live secret key', FAKE.stripeLive],
    ['Stripe restricted live key', FAKE.stripeRestricted],
    ['Stripe test secret key', FAKE.stripeTest],
    ['Stripe webhook secret', FAKE.webhookSecret],
    ['Private key', FAKE.privateKey],
    ['Airtable PAT', FAKE.airtable],
    ['AWS access key', FAKE.awsKey],
    ['AWS temporary access key', FAKE.awsTemp],
    ['Google API key', FAKE.googleApi],
    ['Google OAuth client secret', FAKE.googleOauth],
    ['GitHub personal access token \\(classic\\)', FAKE.githubClassic],
    ['Slack bot/user token', FAKE.slack],
    ['Anthropic API key', FAKE.anthropic],
    ['OpenAI project API key', FAKE.openai],
    ['Perplexity API key', FAKE.perplexity],
  ];
  const root = fixture();
  for (const [label, value] of cases) {
    writeF(root, RUNTIME_SCRATCH, `export const K = '${value}';\n`);
    const out = expectRed(root, new RegExp(`${label} in functions/api/_guard-fixture-scratch\\.js`));
    assert.ok(!/No hardcoded secrets found/.test(out), `${label}: scanner claimed clean`);
  }
  clean(root);
});

test('Phase 4: GitHub fine-grained PAT fires (separate pattern from the classic one)', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH, `export const K = 'github_pat_${'EXAMPLE_'.repeat(8)}';\n`);
  expectRed(root, /GitHub fine-grained PAT in functions\/api\/_guard-fixture-scratch\.js/);
  clean(root);
});

test('Phase 4: token patterns also fire in scripts/ and .github/, not only runtime code', () => {
  const root = fixture();
  writeF(root, SCRIPTS_SCRATCH, `export const K = '${FAKE.awsKey}';\n`);
  expectRed(root, /AWS access key in scripts\/_guard-fixture-scratch\.mjs/);
  clean(root);

  const root2 = fixture();
  writeF(root2, '.github/workflows/_guard-fixture.yml', `env:\n  K: ${FAKE.stripeLive}\n`);
  expectRed(root2, /Stripe live secret key in \.github\/workflows\/_guard-fixture\.yml/);
  clean(root2);
});

test('Phase 4: token patterns fire in root-level *.toml and *.json', () => {
  const root = fixture();
  appendF(root, 'wrangler.toml', `\nFAKE_KEY = "${FAKE.stripeLive}"\n`);
  expectRed(root, /Stripe live secret key in wrangler\.toml/);
  clean(root);

  const root2 = fixture();
  writeF(root2, 'converge.profile.json', JSON.stringify({ k: FAKE.awsKey }, null, 2));
  expectRed(root2, /AWS access key in converge\.profile\.json/);
  clean(root2);
});

test('Phase 4: a hardcoded Bearer literal in runtime code fires', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH, `const h = { Authorization: '${FAKE.bearer}' };\nexport default h;\n`);
  expectRed(root, /Hardcoded Bearer token in functions\/api\/_guard-fixture-scratch\.js/);
  clean(root);
});

test('Phase 4: an op:// reference in runtime code fires (cannot resolve at the edge)', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH, "export const S = 'op://Automation/Some Item/credential';\n");
  expectRed(root, /1Password reference in committed code in functions\/api\/_guard-fixture-scratch\.js/);
  clean(root);
});

test('Phase 4: the redacted echo never prints a whole match', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH, `export const K = '${FAKE.stripeLive}';\n`);
  const out = expectRed(root, /Stripe live secret key/);
  assert.ok(!out.includes(FAKE.stripeLive), 'the guard must not echo the full matched value');
  assert.match(out, /sk_live_EX\.\.\..{4}/);
  clean(root);
});

// ---------- Phase 4: secret scanning (inverse — must NOT fire) ------------
// A scanner everyone bypasses is worse than none. These are the benign
// lookalikes the guard is deliberately scoped to tolerate.

test('Phase 4 INVERSE: op:// in scripts/ and .github/ is the CORRECT pattern and is tolerated', () => {
  const root = fixture();
  // Already true of the real tree (several scripts/ files reference op://), so
  // the baseline proves it; this plants it explicitly in both wide dirs.
  writeF(root, SCRIPTS_SCRATCH, "export const S = 'op://Automation/Some Item/credential';\n");
  writeF(root, '.github/workflows/_guard-fixture.yml',
    'env:\n  K: ${{ secrets.X }} # op://Automation/Some Item/credential\n');
  expectGreen(root);
  clean(root);
});

test('Phase 4 INVERSE: a templated Bearer header is not a hardcoded token', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH,
    'const a = `Bearer ${env.ADMIN_API_SECRET}`;\n'
    + "const b = { Authorization: 'Bearer ' + token };\n"
    + "const c = 'Bearer <token>';\nexport default [a, b, c];\n");
  expectGreen(root);
  clean(root);
});

test('Phase 4 INVERSE: prefixes with a too-short tail do not fire', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH,
    "export const docs = ['sk_live_xxx', 'whsec_short', 'AIzaSy-short', 'pplx-short'];\n");
  expectGreen(root);
  clean(root);
});

test('Phase 4 INVERSE: env-var names and prose about credentials do not fire', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH,
    '// Reads STRIPE_SECRET_KEY / AKIA-style AWS keys are never committed here.\n'
    + 'export const names = [\n'
    + "  'STRIPE_WEBHOOK_SECRET', 'ADMIN_API_SECRET', 'GOOGLE_CLIENT_SECRET',\n"
    + "  'AKIA', 'akiaexampleexample12', '-----BEGIN PUBLIC KEY-----',\n"
    + '];\n');
  expectGreen(root);
  clean(root);
});

test('Phase 4 INVERSE: a hex sha256 in the manifest is not mistaken for a token', () => {
  const root = fixture();
  // guard-manifest.json is a root *.json the scanner reads, and it is 62 lines of
  // 64-char hex. It must never be read as an Airtable PAT or anything else.
  const out = expectGreen(root);
  assert.match(out, /No hardcoded secrets found/);
  clean(root);
});

// ---------- Phase 5: CRM & newsletter safety -------------------------------

test('Phase 5a: a mass DELETE FROM contact in runtime code fails', () => {
  const root = fixture();
  writeF(root, RUNTIME_SCRATCH,
    "export const q = 'DELETE FROM contact WHERE created_at < ?';\n");
  expectRed(root, /Destructive CRM\/newsletter SQL in functions\/api\/_guard-fixture-scratch\.js/);
  clean(root);
});

test('Phase 5a: DROP TABLE and TRUNCATE on a guarded table each fail', () => {
  for (const sql of ['DROP TABLE IF EXISTS newsletter_subscriber', 'TRUNCATE TABLE enrollment']) {
    const root = fixture();
    writeF(root, RUNTIME_SCRATCH, `export const q = '${sql}';\n`);
    expectRed(root, /Destructive CRM\/newsletter SQL/);
    clean(root);
  }
});

test('Phase 5b THE REGRESSION: unsubscribe switched from UPDATE to DELETE fails twice', () => {
  const root = fixture();
  // Both halves of 5b must fire: the status-update assertion AND the DELETE one.
  const src = readF(root, 'functions/api/newsletter/unsubscribe.js')
    .replace(/status\s*=\s*'unsubscribed'/gi, 'deleted = 1')
    + "\nconst q = 'DELETE FROM newsletter_subscriber WHERE email = ?';\n";
  writeF(root, 'functions/api/newsletter/unsubscribe.js', src);
  const out = expectRed(root, /unsubscribe\.js missing status = 'unsubscribed' update/);
  assert.match(out, /unsubscribe\.js contains DELETE FROM newsletter_subscriber/);
  // Phase 5a's blanket destructive-SQL scan must catch the same edit independently.
  assert.match(out, /Destructive CRM\/newsletter SQL in functions\/api\/newsletter\/unsubscribe\.js/);
  clean(root);
});

test('KNOWN GAP Phase 5b: a COMMENTED-OUT status update satisfies the check', () => {
  const root = fixture();
  // 5b is a substring test, so leaving the literal behind in a comment keeps the
  // "Unsubscribe uses status change" PASS line even though the live SQL no longer
  // performs it. `deleted = 1` is not DELETE FROM, so 5a's blanket scan does not
  // fire either, and the guard goes fully green on a real behaviour change.
  // Asserted as ACTUAL behaviour; tightening it is a guard change, not a test change.
  patch(root, 'functions/api/newsletter/unsubscribe.js',
    "status = 'unsubscribed'", "deleted = 1 -- was status = 'unsubscribed'");
  restamp(root, 'functions/api/newsletter/unsubscribe.js');
  const out = expectGreen(root);
  assert.match(out, /PASS {2}Unsubscribe uses status change, not DELETE/);
  clean(root);
});

test('Phase 5c: newsletter send losing its ADMIN_API_SECRET check fails', () => {
  const root = fixture();
  patch(root, 'functions/api/newsletter/send.js', 'ADMIN_API_SECRET', 'PUBLIC_SEND_TOKEN');
  expectRed(root, /Newsletter send\.js missing ADMIN_API_SECRET or Bearer auth check/);
  clean(root);
});

test('Phase 5d: newsletter subscribe losing rate limiting fails', () => {
  const root = fixture();
  // The check accepts either a rateLimit spelling or a bare 429, so both go.
  const src = readF(root, 'functions/api/newsletter/subscribe.js')
    .replace(/[Rr]ate[Ll]imit/g, 'noThrottle')
    .replace(/429/g, '200');
  writeF(root, 'functions/api/newsletter/subscribe.js', src);
  expectRed(root, /Newsletter subscribe\.js missing rate limiting/);
  clean(root);
});

// ---------- Phase 6: link format ------------------------------------------

test('Phase 6: a dynamic content href without a trailing slash fails', () => {
  const root = fixture();
  writeF(root, 'src/pages/_guard-fixture.astro',
    '---\nconst slug = "x";\n---\n<a href={`/library/${slug}`}>link</a>\n');
  expectRed(root, /_guard-fixture\.astro: missing trailing slash in dynamic href/);
  clean(root);
});

test('Phase 6: a static content href without a trailing slash fails', () => {
  const root = fixture();
  writeF(root, 'src/components/_GuardFixture.astro',
    '<a href="/commentary/some-post">link</a>\n');
  expectRed(root, /_GuardFixture\.astro: missing trailing slash in static href/);
  clean(root);
});

test('Phase 6 INVERSE: a static href WITH a trailing slash is not flagged', () => {
  const root = fixture();
  writeF(root, 'src/components/_GuardFixture.astro', '<a href="/commentary/some-post/">b</a>\n');
  const out = expectGreen(root);
  assert.match(out, /PASS {2}All internal content hrefs include trailing slashes/);
  clean(root);
});

test('KNOWN GAP Phase 6: the dynamic-href trailing-slash CONDITION is dead code', () => {
  const root = fixture();
  // SLUG_HREF_RE ends in /\$\{[^}]+\}`\}/ — the `}` of the interpolation must be
  // followed immediately by a backtick. A CORRECT href (`/library/${slug}/`) puts
  // a slash between them, so the regex never matches it at all, and the inner
  // `if (!full.includes('/`}'))` can never evaluate false. The good-link pass is
  // therefore an accident of non-matching, not an asserted behaviour: inverting
  // that condition to `if (true)` changes nothing (teeth-proof row G3).
  // Asserted as ACTUAL behaviour. Collapsing the dead branch is a guard change.
  writeF(root, 'src/pages/_guard-fixture.astro',
    '---\nconst slug = "x";\n---\n<a href={`/library/${slug}/`}>a</a>\n');
  expectGreen(root);
  const guardSrc = readFileSync(GUARD, 'utf8');
  assert.match(guardSrc, /SLUG_HREF_RE = \/href\\s\*=\\s\*\\\{`/,
    'if SLUG_HREF_RE is reshaped, re-derive whether the inner condition is still dead');
  clean(root);
});
