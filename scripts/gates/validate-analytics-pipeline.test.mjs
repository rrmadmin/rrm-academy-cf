/**
 * Falsification harness for the analytics-pipeline proof gates (AG1-AG13).
 *
 * The gate guards the two things on this surface that fail silently: the
 * PII_REGEX that strips identifying param keys before anything reaches GA4 or
 * Analytics Engine, and the CSP / third-party-origin lockdown that keeps
 * rrmacademy.org first-party. A 2026-09-18 audit found the gate had no harness,
 * so an edit weakening any assertion produced a green run. PR #178 made such an
 * edit TRIGGER the gate; these tests make the gate prove it still REFUSES.
 *
 * Each test plants the exact regression its assertion exists to catch and
 * asserts the gate goes RED and NAMES it. A gate nobody has watched fail is a
 * decoration.
 *
 * Fixtures are COPIES of the real src/ + functions/ trees, mutated one
 * regression at a time. Same reasoning as the payment harness, and it applies
 * harder here: AG2/AG4/AG6/AG7/AG9/AG10/AG12 all walk the WHOLE of src/ and
 * functions/ (206 + 177 files) looking for call sites, UTM literals, forbidden
 * origins and custom-dimension names. A hand-built stub tree would have to
 * satisfy eight Phase-1 conversion call sites and fourteen spec dimensions
 * scattered across both trees, and would rot the first time a call site moved.
 * A copy is green by construction (so a gate that fails everything cannot be
 * mistaken for a working one) and cannot drift. Cost is 60ms per fixture.
 *
 * If `the pristine analytics surface passes` is the only red test here, the
 * real repo is red, not this harness.
 *
 * No network, no D1, no GA4. Static analysis over a temp directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
const GATE = join(GATE_DIR, 'validate-analytics-pipeline.mjs');
const REPO = join(GATE_DIR, '..', '..');

const TRACK_ENDPOINT = 'functions/api/track.js';
const TRACK_EVENTS = 'functions/api/_track-events.js';
const MIDDLEWARE = 'functions/_middleware.js';

/** A copy of the real analytics surface in a temp tree. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'analytics-gate-'));
  cpSync(join(REPO, 'src'), join(root, 'src'), { recursive: true });
  cpSync(join(REPO, 'functions'), join(root, 'functions'), { recursive: true });
  return root;
}

const clean = (root) => rmSync(root, { recursive: true, force: true });
const readF = (root, rel) => readFileSync(join(root, rel), 'utf8');
const writeF = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const appendF = (root, rel, body) => writeF(root, rel, readF(root, rel) + body);

/** Replace `find` with `repl` in a fixture file, asserting the anchor existed. */
function patch(root, rel, find, repl) {
  const src = readF(root, rel);
  assert.ok(src.includes(find), `fixture anchor ${JSON.stringify(find)} missing from ${rel}`);
  writeF(root, rel, src.split(find).join(repl));
}

function run(root, args = []) {
  try {
    const out = execFileSync(process.execPath, [GATE, '--json', ...args],
      { env: { ...process.env, ANALYTICS_GATE_ROOT: root }, encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** Run one gate and assert it went red naming `pattern`. */
function expectRed(root, gate, pattern) {
  const { code, out } = run(root, ['--gate', gate, '--quick']);
  assert.equal(code, 1, `${gate} must REFUSE this fixture; it exited 0:\n${out}`);
  assert.match(out, pattern);
  return out;
}

function expectGreen(root, gate) {
  const { code, out } = run(root, ['--gate', gate, '--quick']);
  assert.equal(code, 0, `${gate} must accept this fixture; got:\n${out}`);
  return out;
}

const items = (out) => JSON.parse(out).gates[0].items;

// ---------- baseline -------------------------------------------------------

test('the pristine analytics surface passes all thirteen gates', () => {
  const root = fixture();
  const { code, out } = run(root, ['--quick']);
  assert.equal(code, 0, `a copy of the real surface must be green; got:\n${out}`);
  const report = JSON.parse(out);
  assert.deepEqual(report.gates.map((g) => g.id),
    ['AG1', 'AG2', 'AG3', 'AG4', 'AG5', 'AG6', 'AG7', 'AG8', 'AG9', 'AG10', 'AG11', 'AG12', 'AG13']);
  assert.ok(report.gates.every((g) => g.pass));
  clean(root);
});

test('ANALYTICS_GATE_ROOT actually redirects the scan', () => {
  // Anti-vacuity: if the override were ignored, every fixture below would be
  // scanning the real (green) repo and every test here would be theatre.
  const root = mkdtempSync(join(tmpdir(), 'analytics-gate-empty-'));
  const { code, out } = run(root, ['--gate', 'AG1', '--quick']);
  assert.equal(code, 1, 'an empty tree must not pass AG1');
  assert.match(out, /functions\/api\/track\.js not found — endpoint must exist/);
  clean(root);
});

// ---------- AG1: endpoint contract -----------------------------------------

test('AG1 THE REGRESSION: dropping the PII_REGEX key strip from track.js fails', () => {
  const root = fixture();
  // The realistic shape: someone keeps the VALUE scrubber and drops the KEY
  // one, so `email=` stops being stripped from the param bag. Both the import
  // and the only use have to go for the endpoint to stop referencing it.
  patch(root, TRACK_ENDPOINT, 'PII_REGEX, PII_VALUE_REGEX', 'PII_VALUE_REGEX');
  patch(root, TRACK_ENDPOINT, 'PII_REGEX.test(key)', 'PII_VALUE_REGEX.test(key)');
  expectRed(root, 'AG1', /track\.js must import\/use PII_REGEX/);
  clean(root);
});

test('AG1: dropping the ALLOWED_CLIENT_EVENTS check fails', () => {
  const root = fixture();
  patch(root, TRACK_ENDPOINT, 'ALLOWED_CLIENT_EVENTS', 'ALLOWED_EVENTS_UNCHECKED');
  expectRed(root, 'AG1', /must import\/use ALLOWED_CLIENT_EVENTS/);
  clean(root);
});

test('AG1 SUBTLE: a rate-limit budget raised out of reach fails instead of passing', () => {
  const root = fixture();
  // 300/60s still LOOKS like a rate limit and the call signature still parses.
  // The endpoint is unauthenticated and every accepted beacon is a billed GA4
  // call, so the budget IS the assertion.
  patch(root, TRACK_ENDPOINT, 'checkRateLimit(env, `track:${ip}`, 60, 60)',
    'checkRateLimit(env, `track:${ip}`, 300, 60)');
  expectRed(root, 'AG1', /checkRateLimit too loose: 300\/60s; require <=60\/min/);
  clean(root);
});

test('AG1 SUBTLE: widening the rate-limit WINDOW also fails', () => {
  const root = fixture();
  // 60 per hour reads as stricter but the gate's contract is per-minute; a
  // 3600s window is the same hole from the other direction.
  patch(root, TRACK_ENDPOINT, 'checkRateLimit(env, `track:${ip}`, 60, 60)',
    'checkRateLimit(env, `track:${ip}`, 60, 30)');
  expectRed(root, 'AG1', /checkRateLimit too loose: 60\/30s/);
  clean(root);
});

test('AG1: a checkRateLimit call the gate cannot read the budget from fails, it does not pass', () => {
  const root = fixture();
  patch(root, TRACK_ENDPOINT, 'checkRateLimit(env, `track:${ip}`, 60, 60)',
    'checkRateLimit(env, rateKey(ip), TRACK_LIMIT, TRACK_WINDOW)');
  expectRed(root, 'AG1', /checkRateLimit called but args don't match expected signature/);
  clean(root);
});

test('AG1: removing rate limiting entirely fails', () => {
  const root = fixture();
  patch(root, TRACK_ENDPOINT, 'checkRateLimit', 'noRateLimit');
  expectRed(root, 'AG1', /must invoke checkRateLimit\(\) — endpoint is unauthenticated/);
  clean(root);
});

test('AG1: an inline fetch to google-analytics.com in the endpoint fails', () => {
  const root = fixture();
  appendF(root, TRACK_ENDPOINT,
    "\nawait fetch('https://www.google-analytics.com/mp/collect?api_secret=x', { method: 'POST' });\n");
  expectRed(root, 'AG1', /contains an inline fetch to google-analytics\.com/);
  clean(root);
});

test('AG1: losing the onRequestOptions CORS preflight export fails', () => {
  const root = fixture();
  patch(root, TRACK_ENDPOINT, 'export function onRequestOptions', 'function onRequestOptions');
  expectRed(root, 'AG1', /must export onRequestOptions \(CORS preflight\)/);
  clean(root);
});

test('AG1: losing the service_unavailable shape on missing GA4 env fails', () => {
  const root = fixture();
  patch(root, TRACK_ENDPOINT, "'service_unavailable'", "'misconfigured'");
  expectRed(root, 'AG1', /should return \{ error: 'service_unavailable' \}/);
  clean(root);
});

// ---------- AG2: allowlist coverage ----------------------------------------

test('AG2 THE REGRESSION: a track() call site for an unallowlisted event fails', () => {
  const root = fixture();
  // A plausible rename at ONE end only. At runtime /api/track answers 400 and
  // the event is simply never recorded -- nothing looks broken in the browser.
  patch(root, 'src/pages/faqs.astro', "track('faq_expand', { slug })", "track('faq_expanded', { slug })");
  expectRed(root, 'AG2', /faqs\.astro:\d+ — track\('faq_expanded', …\) but 'faq_expanded' is not in ALLOWED_CLIENT_EVENTS/);
  clean(root);
});

test('AG2 ANTI-VACUITY: an allowlist the gate can no longer parse fails, it does not skip', () => {
  const root = fixture();
  // AG2 AND AG3 both read this one literal. If a refactor to a builder made the
  // parse silently return nothing, both gates would go quiet over real drift.
  patch(root, TRACK_EVENTS, 'ALLOWED_CLIENT_EVENTS = new Set([', 'ALLOWED_CLIENT_EVENTS = buildAllowlist([');
  expectRed(root, 'AG2', /must export ALLOWED_CLIENT_EVENTS = new Set\(\[\.\.\.\]\)/);
  clean(root);
});

test('AG2: an emptied allowlist fails rather than vacuously allowlisting nothing', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, 'ALLOWED_CLIENT_EVENTS = new Set([',
    'ALLOWED_CLIENT_EVENTS = new Set([]);\nconst _RETIRED_ALLOWLIST = ([');
  expectRed(root, 'AG2', /ALLOWED_CLIENT_EVENTS is empty — populate per spec/);
  clean(root);
});

// ---------- AG3: server/client separation ----------------------------------

test('AG3 THE REGRESSION: a server-only conversion added to the client allowlist fails', () => {
  const root = fixture();
  // 'purchase' is fired server-side from the Stripe webhook. Allowing the
  // client to fire it too double-counts revenue in GA4.
  patch(root, TRACK_EVENTS, "  'cta_click',", "  'cta_click',\n  'purchase',");
  expectRed(root, 'AG3', /Server-only event 'purchase' must NOT appear in ALLOWED_CLIENT_EVENTS/);
  clean(root);
});

test('AG3: every one of the five server-only events is actually checked', () => {
  // A loop over a constant is easy to weaken to a loop over its first element.
  for (const evt of ['sign_up', 'signup_from_ask', 'generate_lead', 'begin_checkout', 'purchase']) {
    const root = fixture();
    patch(root, TRACK_EVENTS, "  'cta_click',", `  'cta_click',\n  '${evt}',`);
    expectRed(root, 'AG3', new RegExp(`Server-only event '${evt}' must NOT appear`));
    clean(root);
  }
});

test('AG3 SUBTLE: a re-introduced server-side page_view emitter fails', () => {
  const root = fixture();
  // sendPageView was deleted when the client beacon took over page_view. Adding
  // it back double-counts every pageview, and the payload key is the only
  // static evidence of it.
  appendF(root, MIDDLEWARE,
    "\nasync function sendPageView(env, request) {\n" +
    "  await fetch(GA4_MP, { method: 'POST', body: JSON.stringify({ events: [{ name: 'page_view', params: {} }] }) });\n}\n");
  expectRed(root, 'AG3', /still contains a server-side page_view emitter/);
  clean(root);
});

test('AG3: a deleted middleware fails rather than reporting the shadow absent', () => {
  const root = fixture();
  rmSync(join(root, MIDDLEWARE));
  expectRed(root, 'AG3', /_middleware\.js not found -- cannot verify server page_view shadow is absent/);
  clean(root);
});

// ---------- AG4: required params satisfied ---------------------------------

test('AG4 THE REGRESSION: a call site missing a required param fails', () => {
  const root = fixture();
  // faq_expand requires 'slug'. Renaming the key client-side makes every
  // emission a 400 invalid_request; the browser shows nothing.
  patch(root, 'src/pages/faqs.astro', "track('faq_expand', { slug })", "track('faq_expand', { slug_id: slug })");
  expectRed(root, 'AG4', /faqs\.astro:\d+ — track\('faq_expand', …\) missing required params: slug/);
  clean(root);
});

test('AG4 SUBTLE: ES6 shorthand params are recognized, explicit-only parsing would false-positive', () => {
  const root = fixture();
  // The pristine repo writes `{ slug }`, not `{ slug: slug }`. If AG4's
  // shorthand branch were narrowed away, the real repo would go red on its own
  // idiomatic code -- and the reflex fix is to weaken the gate, not the code.
  expectGreen(root, 'AG4');
  const src = readF(root, 'src/pages/faqs.astro');
  assert.match(src, /track\('faq_expand', \{ slug \}\)/, 'the shorthand call site this test relies on has moved');
  // And it is genuinely checking that event, not skipping it.
  patch(root, 'src/pages/faqs.astro', "track('faq_expand', { slug })", "track('faq_expand', { other: 1 })");
  expectRed(root, 'AG4', /missing required params: slug/);
  clean(root);
});

test('AG4: a spread of the required key counts as supplying it', () => {
  const root = fixture();
  patch(root, 'src/pages/faqs.astro', "track('faq_expand', { slug })", "track('faq_expand', { ...slug })");
  expectGreen(root, 'AG4');
  clean(root);
});

test('AG4 ANTI-VACUITY: an unparseable REQUIRED_PARAMS fails, it does not check zero call sites', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, 'REQUIRED_PARAMS = new Map([', 'REQUIRED_PARAMS = buildRequired([');
  expectRed(root, 'AG4', /must export REQUIRED_PARAMS as either an object literal/);
  clean(root);
});

// ---------- AG5: PII regex intact ------------------------------------------

test('AG5 THE REGRESSION: a term dropped from PII_REGEX fails', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, 'phone|ssn/i', 'phone/i');
  expectRed(root, 'AG5', /PII_REGEX missing term: ssn/);
  clean(root);
});

test('AG5: each of the nine required PII terms is individually checked', () => {
  // The whole point of AG5 is the list. A weakening that checks only the first
  // term, or only that the regex exists, has to be caught for all nine.
  const drops = {
    email: ['/email|user', '/user'],
    user: ['email|user|name', 'email|name'],
    name: ['user|name|password', 'user|password'],
    password: ['name|password|token', 'name|token'],
    token: ['password|token|cookie', 'password|cookie'],
    cookie: ['token|cookie|address', 'token|address'],
    address: ['cookie|address|phone', 'cookie|phone'],
    phone: ['address|phone|ssn', 'address|ssn'],
    ssn: ['phone|ssn/i', 'phone/i'],
  };
  for (const [term, [find, repl]] of Object.entries(drops)) {
    const root = fixture();
    patch(root, TRACK_EVENTS, find, repl);
    expectRed(root, 'AG5', new RegExp(`PII_REGEX missing term: ${term}`));
    clean(root);
  }
});

test('AG5 SUBTLE: losing the /i flag fails, even though the regex still looks complete', () => {
  const root = fixture();
  // This is the edit that actually ships: the term list is untouched, so a
  // reviewer skims past it, and `Email`, `USER_ID`, `Phone` stop being
  // stripped. Every listed term is still present, so a gate that only checks
  // the list would stay green.
  patch(root, TRACK_EVENTS, 'phone|ssn/i;', 'phone|ssn/;');
  expectRed(root, 'AG5', /PII_REGEX must use case-insensitive flag/);
  clean(root);
});

test('AG5 ANTI-VACUITY: a PII_REGEX the gate cannot find fails', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, 'export const PII_REGEX = /', 'export const PII_REGEX = buildPiiRegex(/');
  expectRed(root, 'AG5', /must export PII_REGEX/);
  clean(root);
});

// ---------- AG6: UTM convention --------------------------------------------

test('AG6 THE REGRESSION: an uppercase UTM value fails', () => {
  const root = fixture();
  // GA4 treats utm_source=Newsletter and utm_source=newsletter as two sources,
  // which quietly splits every report that groups by it.
  writeF(root, 'src/pages/_ag6-fixture.astro',
    '<a href="https://rrmacademy.org/donate/?utm_source=Newsletter&utm_medium=email">Give</a>\n');
  expectRed(root, 'AG6', /_ag6-fixture\.astro:\d+ — UTM value 'Newsletter' violates convention/);
  clean(root);
});

test('AG6 SUBTLE: a non-ASCII UTM value fails too, not only uppercase', () => {
  const root = fixture();
  writeF(root, 'src/pages/_ag6-fixture.astro',
    '<a href="/donate/?utm_campaign=fertilité_2026">Give</a>\n');
  expectRed(root, 'AG6', /UTM value 'fertilité_2026' violates convention/);
  clean(root);
});

test('AG6: a runtime-interpolated UTM value is not flagged', () => {
  const root = fixture();
  writeF(root, 'src/pages/_ag6-fixture.astro',
    '<a href={`/donate/?utm_source=${SOURCE}&utm_medium=email`}>give</a>\n');
  expectGreen(root, 'AG6');
  clean(root);
});

// ---------- AG7: no third-party analytics in source ------------------------

test('AG7 THE REGRESSION: a gtag.js script tag in src/ fails', () => {
  const root = fixture();
  writeF(root, 'src/components/_ag7-fixture.astro',
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>\n');
  expectRed(root, 'AG7', /_ag7-fixture\.astro:\d+ — references forbidden third-party origin 'googletagmanager\.com'/);
  clean(root);
});

test('AG7: each of the four forbidden third-party origins is checked', () => {
  for (const origin of ['googletagmanager.com', 'stats.g.doubleclick.net', 'connect.facebook.net', 'analytics.ahrefs.com']) {
    const root = fixture();
    writeF(root, 'src/components/_ag7-fixture.astro', `<script src="https://${origin}/x.js"></script>\n`);
    expectRed(root, 'AG7', new RegExp(`references forbidden third-party origin '${origin.replace(/\./g, '\\.')}'`));
    clean(root);
  }
});

test('AG7 SUBTLE: the GA4 Measurement Protocol host outside _ga4.js fails', () => {
  const root = fixture();
  // Not a third-party SCRIPT and not on the forbidden list -- a second
  // server-side relay is the plausible edit, and it decentralizes the one
  // egress point the architecture depends on.
  writeF(root, 'functions/api/_ag7-relay.js',
    "export const MP = 'https://www.google-analytics.com/mp/collect';\n");
  expectRed(root, 'AG7', /_ag7-relay\.js:\d+ — references www\.google-analytics\.com outside of allowed files/);
  clean(root);
});

test('AG7: a comment documenting a forbidden origin is not flagged', () => {
  const root = fixture();
  writeF(root, 'functions/api/_ag7-fixture.js',
    '// never load googletagmanager.com here; see AG7\n' +
    '/*\n * www.google-analytics.com is reached only via _ga4.js\n */\n');
  expectGreen(root, 'AG7');
  clean(root);
});

// ---------- AG8: CSP lockdown ----------------------------------------------

test('THE REGRESSION: adding gtag.js to script-src fails, behind the quoted keywords', () => {
  // This test used to assert the OPPOSITE, as an honest record of a live
  // defect: AG8 captured the policy with
  // /CSP_VALUE\s*=\s*['"`]([^'"`]+)['"`]/, and because the character class
  // excludes the single quote the capture stopped at the first `'self'` -- 12
  // characters of a 644-character policy, the string "default-src ". Every
  // real CSP begins that way, so AG8 had never inspected a single directive
  // and its "excludes all 4 forbidden origins" line was an all-clear over
  // nothing. The test pinned that so it would go red when the capture was
  // fixed, which is what happened on 2026-09-18; the gate now anchors on the
  // opening delimiter and closes on the same one.
  //
  // `script-src` sits AFTER `default-src 'self'`, so this planting is
  // unreachable to the old regex and reachable to the new one. It is the whole
  // difference, which is why it is the regression test rather than a variant
  // of the one below.
  const root = fixture();
  patch(root, MIDDLEWARE, "script-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
  expectRed(root, 'AG8', /contains forbidden origin 'googletagmanager\.com'/);
  clean(root);
});

test('AG8 reads the WHOLE policy: an origin in the LAST directive is still caught', () => {
  // The far end of the string, past every quoted keyword in the policy. A
  // capture that is merely longer than 12 characters would pass the test above
  // and still miss this, so the two together pin the full span rather than an
  // improvement in it.
  const root = fixture();
  patch(root, MIDDLEWARE, "frame-ancestors 'self'",
    "frame-ancestors 'self' https://connect.facebook.net");
  expectRed(root, 'AG8', /contains forbidden origin 'connect\.facebook\.net'/);
  clean(root);
});

test('AG8 fails loudly when its own capture is too short to be a real policy', () => {
  // The length floor. Without it, any future regex slip returns to a truncated
  // capture wearing a green pass, which is exactly how this gate spent its
  // whole life. A one-directive CSP is indistinguishable from a broken capture
  // and is treated as one deliberately.
  const root = fixture();
  patch(root, MIDDLEWARE, readF(root, MIDDLEWARE).match(/CSP_VALUE = "[^\n]*";/u)[0],
    'CSP_VALUE = "default-src \'self\'";');
  expectRed(root, 'AG8', /captured only \d+ characters of CSP_VALUE/);
  clean(root);
});

test('AG8: the origin comparison itself works; the defect is isolated to the capture', () => {
  // Placed BEFORE the first `'self'`, inside the 12 characters AG8 can see,
  // every one of the four forbidden origins is caught. So the FORBIDDEN_CSP_
  // ORIGINS loop has teeth and the list is genuinely iterated -- it is only
  // ever fed a truncated policy. This is what makes the finding above a
  // one-line regex fix rather than a rewrite.
  for (const origin of ['googletagmanager.com', 'analytics.google.com', 'stats.g.doubleclick.net', 'connect.facebook.net']) {
    const root = fixture();
    patch(root, MIDDLEWARE, 'CSP_VALUE = "default-src ', `CSP_VALUE = "default-src https://${origin} `);
    expectRed(root, 'AG8', new RegExp(`contains forbidden origin '${origin.replace(/\./g, '\\.')}'`));
    clean(root);
  }
});

test('THE REGRESSION: a CSP built by concatenation now FAILS instead of warning', () => {
  // This test also used to assert the opposite, and said so: refactoring
  // CSP_VALUE to a join() made AG8 skip the origin check with a warn and exit
  // 0, and the harness called that the gate's calibration rather than a bug it
  // was allowed to fix. Promoting it was a decision, and it was taken on
  // 2026-09-18 alongside the capture fix, for one reason: the fixture below
  // puts googletagmanager.com in the policy and the OLD behaviour shipped that
  // with a green exit. A CSP this gate cannot read is a CSP this gate is not
  // checking, and silently skipping is the failure mode that let the truncated
  // capture survive in the first place.
  const root = fixture();
  patch(root, MIDDLEWARE, 'const CSP_VALUE = "',
    "const CSP_PARTS = [\"script-src 'self' https://www.googletagmanager.com\"];\n" +
    'const CSP_VALUE = CSP_PARTS.join("; ") + "');
  expectRed(root, 'AG8', /does not define CSP_VALUE as a single string literal, so AG8 cannot read the policy/);
  clean(root);
});

test('AG8 still reads a BACKTICK policy, so the promotion above is not a ban on templates', () => {
  // The promotion must not mean "only double quotes work". A template literal
  // is a single string literal and stays readable, origins and all -- otherwise
  // the hard failure would be a tripwire on ordinary refactors rather than on
  // an unreadable policy.
  const root = fixture();
  const decl = readF(root, MIDDLEWARE).match(/const CSP_VALUE = "[^\n]*";/u)[0];
  const body = decl.slice('const CSP_VALUE = "'.length, -2);
  patch(root, MIDDLEWARE, decl, `const CSP_VALUE = \`${body} https://stats.g.doubleclick.net\`;`);
  expectRed(root, 'AG8', /contains forbidden origin 'stats\.g\.doubleclick\.net'/);
  clean(root);
});

// ---------- AG9: track helper exclusivity ----------------------------------

test('AG9 THE REGRESSION: a raw fetch to /api/track outside the helper fails', () => {
  const root = fixture();
  writeF(root, 'src/components/_ag9-fixture.astro',
    "<script>fetch('/api/track', { method: 'POST', body: JSON.stringify({ event: 'cta_click' }) });</script>\n");
  expectRed(root, 'AG9', /_ag9-fixture\.astro — raw fetch\('\/api\/track'\) outside the helper/);
  clean(root);
});

test('AG9: a raw sendBeacon to /api/track also fails', () => {
  const root = fixture();
  writeF(root, 'src/components/_ag9-fixture.astro',
    "<script>navigator.sendBeacon('/api/track', body);</script>\n");
  expectRed(root, 'AG9', /raw sendBeacon\('\/api\/track'\) outside the helper/);
  clean(root);
});

test('AG9: the helper itself is allowed to fetch /api/track', () => {
  const root = fixture();
  appendF(root, 'src/scripts/track.ts', "\nfetch('/api/track', { method: 'POST' });\n");
  expectGreen(root, 'AG9');
  clean(root);
});

// ---------- AG10: conversion completeness ----------------------------------

test('AG10 THE REGRESSION: a Phase 1 conversion losing its only call site fails', () => {
  const root = fixture();
  // pdf_download is wired in exactly one place. Delete the component and the
  // GA4 Key Event stops being fed, with nothing in the UI to show it.
  rmSync(join(root, 'src/components/PdfDownload.astro'));
  expectRed(root, 'AG10', /Phase 1 conversion 'pdf_download' has no call site/);
  clean(root);
});

test('AG10 SUBTLE: an event name hoisted into a variable fails the static proof', () => {
  const root = fixture();
  // The code still works at runtime, which is exactly why this refactor lands
  // unchallenged. AG10 is a STATIC proof that each Key Event is wired; an
  // indirected name defeats the proof, so the gate must refuse it rather than
  // silently lose coverage of a conversion.
  patch(root, 'src/components/PdfDownload.astro', "__rrmTrack__('pdf_download'",
    "__rrmTrack__(PDF_EVENT /* 'pdf_download' */");
  expectRed(root, 'AG10', /Phase 1 conversion 'pdf_download' has no call site/);
  clean(root);
});

test('AG10: all eight Phase 1 conversions are proved present, not just enumerated', () => {
  const root = fixture();
  const out = expectGreen(root, 'AG10');
  const named = items(out).filter((i) => i.ok === true).map((i) => i.msg);
  for (const evt of ['sign_up', 'generate_lead', 'begin_checkout', 'purchase',
    'scroll_depth', 'video_complete', 'pdf_download', 'copy_citation']) {
    assert.ok(named.some((m) => m.includes(`'${evt}' has at least one call site`)),
      `AG10 must assert a call site for ${evt}; got:\n${named.join('\n')}`);
  }
  clean(root);
});

test('AG10: a server-side sendGA4Event call site counts, and a DOCSTRING one counts too', () => {
  const root = fixture();
  // purchase is server-only. Its one real emitter is the Stripe webhook.
  assert.match(readF(root, 'functions/api/billing/_webhook-checkout.js'),
    /sendGA4Event\([^,]+,[^,]+,\s*'purchase'/);

  // Removing the real emitter leaves AG10 GREEN. BLIND SPOT, named rather than
  // fixed: the only remaining match is the usage EXAMPLE in _ga4.js's own
  // header comment. AG10 does not strip comments, so a docstring can stand in
  // for a wired conversion. Narrowing that is a gate change, not a test change.
  // This half is also the assertion that the sendGA4Event branch of the
  // call-site regex is live at all -- delete that branch and this goes red.
  patch(root, 'functions/api/billing/_webhook-checkout.js',
    "sendGA4Event(env, request, 'purchase'", "sendGA4Event(env, request, 'purchase_v2'");
  expectGreen(root, 'AG10');
  assert.match(readF(root, 'functions/api/_ga4.js'),
    / \* {3}sendGA4Event\(env, request, 'purchase'/, 'the docstring this blind spot rests on has moved');

  // With the comment example gone too, AG10 refuses.
  patch(root, 'functions/api/_ga4.js', "sendGA4Event(env, request, 'purchase'", "sendGA4Event(env, request, 'purchase_v2'");
  expectRed(root, 'AG10', /Phase 1 conversion 'purchase' has no call site/);
  clean(root);
});

// ---------- AG11: bundle size ----------------------------------------------

test('AG11 THE REGRESSION: a track bundle over budget fails', () => {
  const root = fixture();
  writeF(root, 'dist/_astro/track.abc12345.js', 'x'.repeat(4000));
  writeF(root, 'dist/_astro/track-auto.def67890.js', 'y'.repeat(1000));
  const { code, out } = run(root, ['--gate', 'AG11']);
  assert.equal(code, 1, `a 4000-byte track bundle must fail the 3072 budget; got:\n${out}`);
  assert.match(out, /track\.ts bundle track\.abc12345\.js: 4000 bytes EXCEEDS budget 3072/);
  clean(root);
});

test('AG11 SUBTLE: a bundle one byte over budget fails; exactly at budget passes', () => {
  // An off-by-one in the comparison (`<` vs `<=`, or `>=` vs `>`) is the
  // realistic weakening, and it is invisible to any test that uses a bundle
  // far from the boundary.
  const over = fixture();
  writeF(over, 'dist/_astro/track.abc12345.js', 'x'.repeat(3073));
  writeF(over, 'dist/_astro/track-auto.def67890.js', 'y'.repeat(10));
  const r1 = run(over, ['--gate', 'AG11']);
  assert.equal(r1.code, 1, `3073 bytes must exceed the 3072 budget; got:\n${r1.out}`);
  assert.match(r1.out, /3073 bytes EXCEEDS budget 3072/);
  clean(over);

  const at = fixture();
  writeF(at, 'dist/_astro/track.abc12345.js', 'x'.repeat(3072));
  writeF(at, 'dist/_astro/track-auto.def67890.js', 'y'.repeat(3584));
  const r2 = run(at, ['--gate', 'AG11']);
  assert.equal(r2.code, 0, `exactly at budget must pass; got:\n${r2.out}`);
  assert.match(r2.out, /3072 bytes \(budget 3072\)/);
  assert.match(r2.out, /3584 bytes \(budget 3584\)/);
  clean(at);
});

test('AG11: the track-auto budget is enforced separately from track', () => {
  const root = fixture();
  writeF(root, 'dist/_astro/track.abc12345.js', 'x'.repeat(10));
  writeF(root, 'dist/_astro/track-auto.def67890.js', 'y'.repeat(3585));
  const { code, out } = run(root, ['--gate', 'AG11']);
  assert.equal(code, 1, `a 3585-byte track-auto bundle must fail; got:\n${out}`);
  assert.match(out, /track-auto\.ts bundle track-auto\.def67890\.js: 3585 bytes EXCEEDS budget 3584/);
  clean(root);
});

test('AG11 SOFT SPOT BY DESIGN: an unbuilt tree WARNS rather than failing', () => {
  const root = fixture();
  const { code, out } = run(root, ['--gate', 'AG11']);
  assert.equal(code, 0, `no dist/: AG11 must not fail; got:\n${out}`);
  const w = items(out).find((i) => i.ok === null);
  assert.ok(w, `no dist/: AG11 must warn, not fail; got:\n${out}`);
  assert.match(w.msg, /dist\/_astro\/ not found; run `npm run build` first/);
  clean(root);
});

// ---------- AG12: custom dimension parity (WARN-ONLY) ----------------------
// AG12 is calibrated warn-only in the gate's own comment ("Surfaces drift,
// doesn't block deploy"): five spec dimensions are unreferenced in the real
// repo today, so it CANNOT go red by design. Its teeth are the warn items,
// pinned through --json -- same treatment the payment harness gave PG4. If
// AG12 is ever promoted to a hard failure, the exit-code assertions here flag
// it rather than the whole suite going red for unrelated reasons.

test('AG12: an unreferenced spec dimension is a warn and the gate still exits 0', () => {
  const root = fixture();
  const out = expectGreen(root, 'AG12');
  const warns = items(out).filter((i) => i.ok === null).map((i) => i.msg);
  assert.ok(warns.some((m) => m.includes("dimension 'content_pillar' not yet referenced")),
    `expected a warn for the unreferenced content_pillar; got:\n${out}`);
  assert.ok(!items(out).some((i) => i.ok === false), 'AG12 is warn-only by design');
  clean(root);
});

test('AG12: a dimension that appears in source flips its warn to a pass', () => {
  const root = fixture();
  const before = items(expectGreen(root, 'AG12')).filter((i) => i.ok === null).length;
  writeF(root, 'functions/api/_ag12-fixture.js', "export const dims = { content_pillar: 'endometriosis' };\n");
  const after = items(expectGreen(root, 'AG12'));
  assert.equal(after.filter((i) => i.ok === null).length, before - 1,
    'adding content_pillar to source must retire exactly one warn');
  assert.ok(after.some((i) => i.ok === true && i.msg.includes("dimension 'content_pillar' appears in source")));
  clean(root);
});

// ---------- AG13: REQUIRED_PARAMS disjoint from PII_REGEX ------------------

test('AG13 THE REGRESSION: a required param that PII_REGEX would strip fails', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, "['glossary_lookup',    ['term']],",
    "['glossary_lookup',    ['term']],\n  ['lead_capture',       ['email']],");
  expectRed(root, 'AG13', /REQUIRED_PARAMS key 'email' matches PII_REGEX/);
  clean(root);
});

test('AG13 SUBTLE: a plausible param rename that collides on a SUBSTRING fails', () => {
  const root = fixture();
  // pdf_download's 'source' renamed to 'source_name' reads like a clarification
  // and passes review. PII_REGEX matches the 'name' inside it, so track.js
  // strips the key before the required-params check runs and EVERY
  // pdf_download becomes a 400. Nothing else in the repo notices.
  patch(root, TRACK_EVENTS, "['pdf_download',       ['slug', 'source']],",
    "['pdf_download',       ['slug', 'source_name']],");
  expectRed(root, 'AG13', /REQUIRED_PARAMS key 'source_name' matches PII_REGEX/);
  clean(root);
});

test('AG13: the real key set is genuinely replayed against the real regex', () => {
  const root = fixture();
  const out = expectGreen(root, 'AG13');
  assert.match(out, /all \d+ REQUIRED_PARAMS keys are disjoint from PII_REGEX/);
  const n = Number(out.match(/all (\d+) REQUIRED_PARAMS keys/)[1]);
  // 19 distinct keys across the 18 REQUIRED_PARAMS entries today. The floor
  // guards against a parser weakening that quietly checks only the first entry.
  assert.ok(n >= 19, `AG13 must be checking the whole key set, not a handful; it checked ${n}`);
  clean(root);
});

test('AG13 ANTI-VACUITY: a REQUIRED_PARAMS that yields zero keys does not report success', () => {
  const root = fixture();
  patch(root, TRACK_EVENTS, 'REQUIRED_PARAMS = new Map([', 'REQUIRED_PARAMS = new Map([]);\nconst _RETIRED = ([');
  const out = expectGreen(root, 'AG13');
  const w = items(out).find((i) => i.ok === null);
  assert.ok(w, `zero keys must warn, not silently pass; got:\n${out}`);
  assert.match(w.msg, /REQUIRED_PARAMS parsed but yielded zero keys — nothing to check/);
  assert.ok(!items(out).some((i) => i.ok === true && /disjoint from PII_REGEX/.test(i.msg)),
    'an empty key set must not print the all-clear');
  clean(root);
});
