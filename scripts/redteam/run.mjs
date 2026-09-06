#!/usr/bin/env node
/**
 * THE RED-TEAM RUNNER. Turns every case in `cases.mjs` into a real request and
 * compares what came back with what the case says must come back.
 *
 * TWO MODES, ONE CASE TABLE.
 *
 *   hermetic (default)  the Pages Functions run IN PROCESS against a real
 *                       SQLite engine loaded with the committed schema, the
 *                       two survey databases as SEPARATE engines, KV, R2, and
 *                       an upstream router that COUNTS every call to Stripe,
 *                       SES, GA4, Turnstile and Google Ads. No network, no
 *                       credentials, no live data. Runs on every PR.
 *
 *   live                real HTTPS at rrmacademy.org. It sends GETs and
 *                       requests that MUST BE REFUSED, and nothing else: no
 *                       signup, no post, no checkout, no donation, no webhook
 *                       event. A case that could only be run by doing one of
 *                       those reports SKIP with that reason rather than
 *                       passing on a refusal that proves nothing.
 *
 * A FAIL IS A FINDING. The exit code is non-zero on any FAIL. A failure that
 * has been adjudicated carries `known: 'RRMA-RT-n'` plus a written note and
 * reports as KNOWN, which keeps the run green enough to gate a PR while
 * printing the finding in every grid and every report. A KNOWN case that
 * starts passing FAILS the suite: the marker would otherwise hide the next
 * regression of the same case.
 *
 * Usage:
 *   node scripts/redteam/run.mjs
 *   node scripts/redteam/run.mjs --mode live --base https://rrmacademy.org
 *   node scripts/redteam/run.mjs --family auth,money --verbose
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CASES, FAMILIES, STACK_MARKERS, countByFamily } from './cases.mjs';
import { RRM_ACADEMY_TARGET, HOSTS, IDENTITIES, SEEDED_PASSWORD } from './targets.mjs';
import { identityHeaders, stripeSignature } from './fakes/identities.mjs';
import {
  redteamEnv, dbWrites, symptomRows, symptomSql, SECRET_FRAGMENTS,
  FORGED_COOKIE, VICTIM_EMAIL, WEBHOOK_SECRET,
} from './fakes/env.mjs';
import { installUpstream } from './fakes/upstream.mjs';
import { dispatch } from './fakes/dispatch.mjs';
import { hashToken } from '../../functions/api/auth/_shared.js';

const ROOT = join(import.meta.dirname, '..', '..');

// --------------------------------------------------------------------------
// Arguments.
// --------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { mode: 'hermetic', base: null, families: null, verbose: false, report: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') options.mode = argv[++index];
    else if (arg === '--base') options.base = argv[++index];
    else if (arg === '--family') options.families = new Set(argv[++index].split(','));
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--no-report') options.report = false;
  }
  if (options.mode !== 'hermetic' && options.mode !== 'live') {
    throw new Error(`redteam: --mode must be hermetic or live, not ${JSON.stringify(options.mode)}`);
  }
  if (options.mode === 'live' && !options.base) options.base = RRM_ACADEMY_TARGET.liveBase;
  return options;
}

// --------------------------------------------------------------------------
// Sending one request, in either mode.
// --------------------------------------------------------------------------

function urlFor(kase, options) {
  const host = HOSTS[kase.host] ?? HOSTS.apex;
  const origin = options.mode === 'live' ? options.base : `https://${host.hostname}`;
  return `${origin}${kase.path}${kase.query ?? ''}`;
}

function headersFor(kase, options) {
  const { headers, skipReason } = identityHeaders(kase.as, { mode: options.mode });
  if (skipReason) return { headers: null, skipReason };
  /* An IP is not optional here: several endpoints refuse 503 without
     CF-Connecting-IP, which would look like a finding and is really the
     harness forgetting to be a request from somewhere. */
  return { headers: { 'CF-Connecting-IP': '203.0.113.1', ...headers, ...(kase.headers ?? {}) }, skipReason: null };
}

/** One response, normalised to the shape the evaluator reads. */
async function normalise(response) {
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an HTML page is not JSON, and that is fine */ }
  const headers = {};
  for (const [name, value] of response.headers) headers[name.toLowerCase()] = value;
  /* Set-Cookie is the one header a login answers with MORE THAN ONE of (the
     HttpOnly session cookie and the JS-readable auth hint). Iterating Headers
     collapses them, and the collapsed value dropped the session cookie
     entirely, which made the session-fixation case report "no cookie was
     issued" about a login that had issued two. getSetCookie() is the only
     reader that sees both. */
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (setCookies.length) headers['set-cookie'] = setCookies.join('\n');
  return { status: response.status, text, json, headers, setCookies };
}

async function sendHermetic(kase, context, overrides = {}) {
  const url = overrides.url ?? urlFor(kase, context.options);
  const { headers, skipReason } = headersFor(kase, context.options);
  if (skipReason) return { skipReason };
  const method = overrides.method ?? kase.method ?? 'GET';
  const init = { method, headers: { ...headers, ...(overrides.headers ?? {}) } };
  const body = overrides.body !== undefined ? overrides.body : kase.body;
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = body;
  const response = await dispatch(new Request(url, init), context.env);
  return { response: await normalise(response) };
}

async function sendLive(kase, options) {
  const url = urlFor(kase, options);
  const { headers, skipReason } = headersFor(kase, options);
  if (skipReason) return { skipReason };
  const method = kase.method ?? 'GET';
  const init = { method, headers, redirect: 'manual' };
  if (kase.body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = kase.body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response: await normalise(response) };
  } catch (err) {
    return { error: String(err?.message ?? err).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
// Evaluating an expectation.
// --------------------------------------------------------------------------

function subsetMatches(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(value)) {
      return `body.${key} is ${JSON.stringify(actual?.[key])}, expected ${JSON.stringify(value)}`;
    }
  }
  return null;
}

/**
 * -> an array of failure reasons, empty when the case passed.
 *
 * A LIVE EXPECTATION REPLACES THE HERMETIC ONE, it does not merge into it.
 * The two modes see different things at the same door: hermetically a case
 * can assert what a fake counted, and live it cannot. Merging would fail a
 * live case for not proving something only the process can see, which is a
 * fault in the harness rather than in the deployment.
 */
export function evaluate(kase, observed, extras = {}) {
  const expect = observed.expectOverride ?? kase.expect ?? {};
  const response = observed.response;
  const reasons = [];
  if (!response) return ['no response'];

  if (expect.status !== undefined) {
    const allowed = Array.isArray(expect.status) ? expect.status : [expect.status];
    if (!allowed.includes(response.status)) reasons.push(`status ${response.status}, expected ${allowed.join(' or ')}`);
  }

  if (expect.bodyEquals !== undefined && JSON.stringify(response.json) !== JSON.stringify(expect.bodyEquals)) {
    reasons.push(`body ${JSON.stringify(response.json)?.slice(0, 160)}, expected ${JSON.stringify(expect.bodyEquals)}`);
  }

  if (expect.bodyIncludes !== undefined) {
    const reason = subsetMatches(response.json, expect.bodyIncludes);
    if (reason) reasons.push(reason);
  }

  for (const fragment of expect.mustContain ?? []) {
    if (!response.text.includes(fragment)) reasons.push(`body does not carry ${JSON.stringify(fragment)}`);
  }

  for (const fragment of expect.mustNotContain ?? []) {
    if (response.text.includes(fragment)) reasons.push(`body LEAKS ${JSON.stringify(fragment.slice(0, 60))}`);
  }

  for (const [name, matcher] of Object.entries(expect.headerMatches ?? {})) {
    const value = response.headers[name.toLowerCase()];
    if (value === undefined) reasons.push(`header ${name} is absent`);
    else if (matcher instanceof RegExp ? !matcher.test(value) : value !== matcher) {
      reasons.push(`header ${name} is ${JSON.stringify(value)}, expected ${matcher}`);
    }
  }

  for (const name of expect.headerAbsent ?? []) {
    if (response.headers[name.toLowerCase()] !== undefined) {
      reasons.push(`header ${name} is present (${JSON.stringify(response.headers[name.toLowerCase()])}) and must not be`);
    }
  }

  for (const [name, forbidden] of Object.entries(expect.headerAbsentValue ?? {})) {
    if (response.headers[name.toLowerCase()] === forbidden) reasons.push(`header ${name} is exactly ${JSON.stringify(forbidden)} and must not be`);
  }

  for (const [name, forbidden] of Object.entries(expect.headerAbsentSubstring ?? {})) {
    const value = response.headers[name.toLowerCase()] ?? '';
    if (value.includes(forbidden)) reasons.push(`header ${name} carries ${JSON.stringify(forbidden)} and must not`);
  }

  if (expect.spends && extras.spend) {
    for (const [key, cap] of Object.entries(expect.spends)) {
      const actual = extras.spend[key];
      if (actual === undefined) reasons.push(`no spend counter named ${key}`);
      else if (actual > cap) reasons.push(`spent ${actual} ${key}, expected at most ${cap}`);
    }
  }

  return reasons;
}

/**
 * THE ASSERTION EVERY HERMETIC CASE GETS, whether it asked for it or not: no
 * response body anywhere in this suite may carry a configured secret or a
 * stack frame. Written as a sweep rather than as a per-case expectation
 * because the leak that matters is the one nobody thought to look for.
 */
function universalLeakCheck(response) {
  if (!response) return [];
  const reasons = [];
  for (const secret of SECRET_FRAGMENTS) {
    if (secret && response.text.includes(secret)) reasons.push(`body LEAKS a configured secret (${secret.slice(0, 8)}...)`);
  }
  for (const marker of STACK_MARKERS) {
    if (response.text.includes(marker)) reasons.push(`body LEAKS an internal detail: ${JSON.stringify(marker)}`);
  }
  return reasons;
}

// --------------------------------------------------------------------------
// Scenarios: the cases whose assertion is a RELATIONSHIP between requests.
// --------------------------------------------------------------------------

const SURVEY_TOKEN = 'redteam-survey-token';

function seedSurveyToken(env, { email = VICTIM_EMAIL, used = false } = {}) {
  return env.SURVEY_TOKENS.put(`token:${SURVEY_TOKEN}`, JSON.stringify({ email, created: Date.now(), used, userorigin: null, utmSource: null }));
}

async function signedEvent(event, { secret = WEBHOOK_SECRET, timestamp } = {}) {
  const payload = JSON.stringify(event);
  return { payload, signature: await stripeSignature(payload, secret, timestamp ? { timestamp } : {}) };
}

const SCENARIOS = {
  /** N identical requests; the assertion is where the limiter engages. */
  async 'rate-limit'(kase, context) {
    const statuses = [];
    for (let i = 0; i < kase.rateLimit.count; i += 1) {
      const sent = await sendHermetic(kase, context);
      statuses.push(sent.response?.status ?? 0);
    }
    const reasons = [];
    const final = statuses[statuses.length - 1];
    if (final !== kase.rateLimit.expectFinal) reasons.push(`request ${statuses.length} answered ${final}, expected ${kase.rateLimit.expectFinal}`);
    if (statuses[0] === 429) reasons.push('the FIRST request was already rate limited, so this proves nothing about the limiter');
    return { reasons, detail: `statuses ${statuses.join(',')}` };
  },

  /**
   * The same request for an address that exists and one that does not. The
   * assertion is EQUALITY of the two answers, which is the only shape of
   * enumeration a harness can hold without timing measurements.
   */
  async 'enumeration'(kase, context) {
    const results = {};
    for (const which of ['known', 'unknown']) {
      const { env } = await redteamEnv();
      const sent = await sendHermetic(kase, { ...context, env }, { body: JSON.stringify(kase.pair[which]) });
      results[which] = sent.response;
    }
    const reasons = [];
    if (results.known.status !== results.unknown.status) {
      reasons.push(`status differs: known=${results.known.status} unknown=${results.unknown.status}`);
    }
    if (results.known.text !== results.unknown.text) {
      reasons.push(`body differs: known=${results.known.text.slice(0, 90)} unknown=${results.unknown.text.slice(0, 90)}`);
    }
    return { reasons, detail: `known ${results.known.status} ${results.known.text.slice(0, 60)} | unknown ${results.unknown.status} ${results.unknown.text.slice(0, 60)}` };
  },

  /**
   * A duplicate signup in a different case: the answer is deliberately
   * indistinguishable, so the row count is what the case actually holds.
   */
  async 'signup-duplicate'(kase, context) {
    const before = context.env.DB._sqlite.prepare('SELECT COUNT(*) AS n FROM user').get().n;
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({
        email: VICTIM_EMAIL.toUpperCase(),
        password: SEEDED_PASSWORD,
        firstName: 'Redteam',
        lastName: 'Sample',
        turnstileToken: 'redteam-token',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const after = context.env.DB._sqlite.prepare('SELECT COUNT(*) AS n FROM user').get().n;
    const matching = context.env.DB._sqlite
      .prepare('SELECT COUNT(*) AS n FROM user WHERE email = ? COLLATE NOCASE').get(VICTIM_EMAIL).n;
    const reasons = [];
    if (after !== before) reasons.push(`the user table grew from ${before} to ${after} rows, expected no growth`);
    if (matching !== 1) reasons.push(`${matching} accounts now hold that address in some case, expected exactly 1`);
    if (sent.response.text.toLowerCase().includes('already')) reasons.push('the answer says the address is already registered, which is an enumeration oracle');
    return { reasons, detail: `status ${sent.response.status}, users ${before} -> ${after}, matching ${matching}` };
  },

  /** A real reset token: redeemed once, refused on replay, one password write. */
  async 'reset-replay'(kase, context) {
    const token = 'r'.repeat(64);
    const tokenHash = await hashToken(token);
    context.env.DB._sqlite.prepare(
      "INSERT INTO password_reset (id, user_id, token_hash, expires_at, purpose) VALUES ('pr_redteam', 'u_victim', ?, ?, 'reset')"
    ).run(tokenHash, Math.floor(Date.now() / 1000) + 3600);

    const body = JSON.stringify({ token, password: 'Redteam-N3w-Horse-Battery' });
    const first = await sendHermetic(kase, context, { body });
    const second = await sendHermetic(kase, context, { body });

    const reasons = [];
    if (first.response.status !== 200) reasons.push(`the first redemption answered ${first.response.status}, expected 200`);
    if (second.response.status !== 400) reasons.push(`the REPLAY answered ${second.response.status}, expected 400`);
    const left = context.env.DB._sqlite.prepare('SELECT COUNT(*) AS n FROM password_reset').get().n;
    if (left !== 0) reasons.push(`${left} reset token rows survived redemption, expected 0`);
    return { reasons, detail: `first ${first.response.status}, replay ${second.response.status}, rows left ${left}` };
  },

  /** Logging in while presenting a chosen cookie must not adopt that cookie. */
  async 'session-fixation'(kase, context) {
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({ email: VICTIM_EMAIL, password: SEEDED_PASSWORD, turnstileToken: 'redteam-token' }),
      headers: { Cookie: `session=${FORGED_COOKIE}`, 'content-type': 'application/json' },
    });
    const setCookie = sent.response.headers['set-cookie'] ?? '';
    const reasons = [];
    if (sent.response.status !== 200) reasons.push(`login answered ${sent.response.status}, expected 200 so the fixation question is even reachable`);
    if (setCookie.includes(FORGED_COOKIE)) reasons.push('the login adopted the attacker-supplied session id');
    if (!/session=/.test(setCookie)) reasons.push('the login issued no session cookie at all, so nothing was rotated');
    return { reasons, detail: `status ${sent.response.status}, set-cookie ${setCookie.slice(0, 60)}` };
  },

  /** A signature that is valid for a different body does not validate this one. */
  async 'webhook-swapped-payload'(kase, context) {
    const a = await signedEvent({ id: 'evt_redteam_a', type: 'checkout.session.completed', data: { object: {} } });
    const b = await signedEvent({ id: 'evt_redteam_b', type: 'charge.refunded', data: { object: {} } });
    const sent = await sendHermetic(kase, context, {
      body: b.payload,
      headers: { 'stripe-signature': a.signature, 'content-type': 'application/json' },
    });
    const reasons = [];
    if (sent.response.status !== 400) reasons.push(`a swapped-payload signature answered ${sent.response.status}, expected 400`);
    if (dbWrites(context.env) !== 0) reasons.push(`${dbWrites(context.env)} rows were written for an unverified event, expected 0`);
    return { reasons, detail: `status ${sent.response.status}, writes ${dbWrites(context.env)}` };
  },

  /** A correctly signed event from an hour ago is outside Stripe's tolerance. */
  async 'webhook-stale-timestamp'(kase, context) {
    const stale = await signedEvent(
      { id: 'evt_redteam_stale', type: 'checkout.session.completed', data: { object: {} } },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 }
    );
    const sent = await sendHermetic(kase, context, {
      body: stale.payload,
      headers: { 'stripe-signature': stale.signature, 'content-type': 'application/json' },
    });
    const reasons = [];
    if (sent.response.status !== 400) reasons.push(`an hour-old signature answered ${sent.response.status}, expected 400`);
    return { reasons, detail: `status ${sent.response.status}` };
  },

  /**
   * A signed event of a type nobody handles must answer 2xx.
   *
   * This is the case that matters most in the family and it is easy to get
   * backwards: Stripe RETRIES every non-2xx response for three days, so
   * answering 400 or 500 to a permanently unhandleable event is not a
   * refusal, it is a self-inflicted retry storm.
   */
  async 'webhook-unknown-type'(kase, context) {
    const event = await signedEvent({ id: 'evt_redteam_unknown', type: 'redteam.unknown.event', data: { object: {} } });
    const sent = await sendHermetic(kase, context, {
      body: event.payload,
      headers: { 'stripe-signature': event.signature, 'content-type': 'application/json' },
    });
    const reasons = [];
    if (sent.response.status < 200 || sent.response.status >= 300) {
      reasons.push(`an unhandled event type answered ${sent.response.status}; Stripe retries every non-2xx for three days`);
    }
    return { reasons, detail: `status ${sent.response.status}` };
  },

  /** The same signed event twice: acknowledged twice, processed once. */
  async 'webhook-replay'(kase, context) {
    const event = await signedEvent({ id: 'evt_redteam_replay', type: 'redteam.unknown.event', data: { object: {} } });
    const headers = { 'stripe-signature': event.signature, 'content-type': 'application/json' };
    const first = await sendHermetic(kase, context, { body: event.payload, headers });
    const second = await sendHermetic(kase, context, { body: event.payload, headers });
    const rows = context.env.DB._sqlite.prepare('SELECT COUNT(*) AS n FROM webhook_event WHERE event_id = ?').get('evt_redteam_replay').n;
    const reasons = [];
    for (const [label, sent] of [['first', first], ['replay', second]]) {
      if (sent.response.status < 200 || sent.response.status >= 300) reasons.push(`the ${label} delivery answered ${sent.response.status}, expected 2xx`);
    }
    if (rows !== 1) reasons.push(`the dedup ledger holds ${rows} rows for one event id, expected exactly 1`);
    return { reasons, detail: `statuses ${first.response.status}/${second.response.status}, ledger rows ${rows}` };
  },

  /** A price id in the body must never become the price Stripe is asked for. */
  async 'checkout-price-injection'(kase, context) {
    const injected = 'price_redteam_free_forever';
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({ mode: 'subscription', tier: 'member', priceId: injected, price: injected, price_id: injected }),
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.70' },
    });
    const stripeCalls = context.upstream.calls.filter((c) => c.service === 'stripe');
    const reasons = [];
    if (stripeCalls.some((c) => c.url.includes(injected))) reasons.push('the injected price id reached the Stripe API');
    if (sent.response.text.includes(injected)) reasons.push('the injected price id was echoed back to the client');
    return { reasons, detail: `status ${sent.response.status}, ${stripeCalls.length} stripe calls` };
  },

  /** A currency in the body must never become the currency Stripe is asked for. */
  async 'checkout-currency-injection'(kase, context) {
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({ mode: 'payment', amount: 2500, currency: 'xxx' }),
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.71' },
    });
    const stripeCalls = context.upstream.calls.filter((c) => c.service === 'stripe');
    const reasons = [];
    if (stripeCalls.some((c) => /currency=xxx/i.test(c.url))) reasons.push('the injected currency reached the Stripe API');
    if (sent.response.text.toLowerCase().includes('"xxx"')) reasons.push('the injected currency was echoed back to the client');
    return { reasons, detail: `status ${sent.response.status}, ${stripeCalls.length} stripe calls` };
  },

  /** A valid survey token submits once; the replay stores no second row. */
  async 'survey-replay'(kase, context) {
    await seedSurveyToken(context.env);
    const body = JSON.stringify({
      token: SURVEY_TOKEN,
      symptoms: { tier1: ['pain'], tier2: [], tier3: [] },
      score: { total: 3, tier1: 3, tier2: 0, tier3: 0 },
    });
    const first = await sendHermetic(kase, context, { body, headers: { 'content-type': 'application/json' } });
    const second = await sendHermetic(kase, context, { body, headers: { 'content-type': 'application/json' } });
    const rows = symptomRows(context.env);
    const reasons = [];
    if (first.response.status !== 200) reasons.push(`the first submission answered ${first.response.status}, expected 200`);
    if (second.response.status !== 409) reasons.push(`the REPLAY answered ${second.response.status}, expected 409`);
    if (rows.length !== 1) reasons.push(`${rows.length} symptom rows were written for one token, expected exactly 1`);
    return { reasons, detail: `first ${first.response.status}, replay ${second.response.status}, symptom rows ${rows.length}` };
  },

  /**
   * THE PSEUDONYMISATION SPLIT, asserted against the STORE and not against a
   * response. The symptom database must hold the answers and nothing that
   * identifies a person, and it must never even have been HANDED an address:
   * a statement that carried one and was rolled back would still have put it
   * in a query log.
   */
  async 'pseudonymisation'(kase, context) {
    await seedSurveyToken(context.env);
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({
        token: SURVEY_TOKEN,
        symptoms: { tier1: ['pain', 'fatigue'], tier2: ['nausea'], tier3: [] },
        score: { total: 7, tier1: 4, tier2: 2, tier3: 1 },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const reasons = [];
    if (sent.response.status !== 200) reasons.push(`the submission answered ${sent.response.status}, expected 200`);

    const rows = symptomRows(context.env);
    if (rows.length !== 1) reasons.push(`${rows.length} symptom rows, expected exactly 1`);

    const columns = Object.keys(rows[0] ?? {});
    for (const forbidden of ['email', 'name', 'first_name', 'last_name', 'ip']) {
      if (columns.includes(forbidden)) reasons.push(`the symptom store has an identity column named ${forbidden}`);
    }
    const asText = JSON.stringify(rows);
    if (asText.includes(VICTIM_EMAIL)) reasons.push('the symptom store holds the address');
    for (const sql of symptomSql(context.env)) {
      if (sql.includes(VICTIM_EMAIL)) reasons.push('a statement handed to the symptom store carried the address inline');
    }

    const identities = context.env.SURVEY_DB._sqlite.prepare('SELECT email, airtable_record_id FROM survey_identities').all();
    if (identities.length !== 1) reasons.push(`${identities.length} identity rows in the OTHER database, expected exactly 1`);
    else if (identities[0].email !== VICTIM_EMAIL) reasons.push('the identity row does not carry the address it was supposed to link');
    else if (identities[0].airtable_record_id !== rows[0]?.rec_id) reasons.push('the identity row does not join to the symptom row by rec_id');

    return { reasons, detail: `symptom rows ${rows.length}, identity rows ${identities.length}, split intact ${reasons.length === 0}` };
  },

  /** A script tag in a free-text answer is data, never a response fragment. */
  async 'survey-script-payload'(kase, context) {
    await seedSurveyToken(context.env);
    const payload = '<script>alert("redteam")</script>';
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({
        token: SURVEY_TOKEN,
        symptoms: { tier1: [payload], tier2: [], tier3: [] },
        score: { total: 1, tier1: 1, tier2: 0, tier3: 0 },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const reasons = [];
    if (sent.response.status !== 200) reasons.push(`the submission answered ${sent.response.status}, expected 200`);
    if (sent.response.text.includes('<script')) reasons.push('the response echoed the script tag back');
    const contentType = sent.response.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) reasons.push(`the response content-type is ${contentType}, expected JSON`);
    return { reasons, detail: `status ${sent.response.status}, content-type ${contentType}` };
  },

  /** The token probe answers about validity, never about the person. */
  async 'survey-validate-no-address'(kase, context) {
    await seedSurveyToken(context.env);
    const sent = await sendHermetic(kase, context, {
      url: `https://rrmacademy.org/api/survey/validate?token=${SURVEY_TOKEN}`,
      method: 'GET',
    });
    const reasons = [];
    if (sent.response.status !== 200) reasons.push(`a valid token probe answered ${sent.response.status}, expected 200`);
    if (sent.response.json?.valid !== true) reasons.push(`the probe said valid=${JSON.stringify(sent.response.json?.valid)}, expected true`);
    if (sent.response.text.includes(VICTIM_EMAIL)) reasons.push('the probe returned the address behind the token');
    return { reasons, detail: `status ${sent.response.status}, body ${sent.response.text.slice(0, 60)}` };
  },

  /** A CRLF in a name must not become a header line in the notification mail. */
  async 'contact-header-injection'(kase, context) {
    const sent = await sendHermetic(kase, context, {
      body: JSON.stringify({
        name: 'Redteam Sender\r\nBcc: redteam-exfil@redteam.example',
        email: 'redteam@redteam.example',
        message: 'A contact message that is comfortably long enough to be accepted.',
        turnstileToken: 'redteam-token',
      }),
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.72' },
    });
    const mail = context.upstream.mail;
    const reasons = [];
    const bodies = mail.map((m) => m.body ?? '').join('\n');
    if (/"Bcc"\s*:/i.test(bodies)) reasons.push('the forged Bcc became a real header in the SES request');
    if (bodies.includes('redteam-exfil@redteam.example') && /Destination[^}]*redteam-exfil/.test(bodies)) {
      reasons.push('the forged address reached the SES Destination');
    }
    return { reasons, detail: `status ${sent.response.status}, ${mail.length} SES calls` };
  },

  /** A database that throws answers a generic 500, never the engine's words. */
  async 'db-throws'(kase, context) {
    const real = context.env.DB;
    context.env.DB = {
      ...real,
      prepare(sql) {
        if (sql.includes('saved_page')) throw new Error('D1_ERROR: no such table: saved_page at Object.prepare');
        return real.prepare(sql);
      },
    };
    const sent = await sendHermetic(kase, context);
    context.env.DB = real;
    const reasons = [];
    if (sent.response.status !== 500) reasons.push(`a broken database answered ${sent.response.status}, expected 500`);
    for (const marker of ['D1_ERROR', 'no such table', 'at Object.']) {
      if (sent.response.text.includes(marker)) reasons.push(`the 500 body LEAKS ${JSON.stringify(marker)}`);
    }
    return { reasons, detail: `status ${sent.response.status}, body ${sent.response.text.slice(0, 70)}` };
  },
};

// --------------------------------------------------------------------------
// The run.
// --------------------------------------------------------------------------

/**
 * The console, captured for the duration of one case. Routes log to all three
 * channels; without this, a 150-case run prints unreadably through
 * `node --test`, and a case that WANTS to inspect a log line could not.
 */
function captureLogs() {
  const logs = [];
  const real = { error: console.error, log: console.log, warn: console.warn };
  const capture = (...args) => logs.push(args.map((one) => String(one)).join(' '));
  console.error = capture;
  console.log = capture;
  console.warn = capture;
  return {
    logs,
    restore: () => { console.error = real.error; console.log = real.log; console.warn = real.warn; },
  };
}

async function runHermeticCase(kase, options) {
  if (kase.hermetic?.skip) return { outcome: 'SKIP', reasons: [kase.hermetic.skip], detail: kase.hermetic.skip };

  const upstream = installUpstream();
  const capture = captureLogs();
  let built;
  try {
    built = await redteamEnv();
  } catch (err) {
    capture.restore();
    upstream.restore();
    return { outcome: 'FAIL', reasons: [`env build threw: ${String(err?.message ?? err).slice(0, 200)}`], detail: 'env threw' };
  }
  const { env, counts } = built;
  const context = { env, counts, upstream, options };

  try {
    if (kase.scenario) {
      const scenario = SCENARIOS[kase.scenario];
      if (!scenario) throw new Error(`redteam: no scenario named ${kase.scenario}`);
      const { reasons, detail } = await scenario(kase, context);
      return { outcome: reasons.length ? 'FAIL' : 'PASS', reasons, detail };
    }

    const sent = await sendHermetic(kase, context);
    if (sent.skipReason) return { outcome: 'SKIP', reasons: [sent.skipReason], detail: sent.skipReason };

    const spend = { ...upstream.counts, ...counts, dbWrites: dbWrites(env) };
    const reasons = [
      ...evaluate(kase, sent, { logs: capture.logs, spend }),
      ...universalLeakCheck(sent.response),
    ];
    return {
      outcome: reasons.length ? 'FAIL' : 'PASS',
      reasons,
      detail: `${sent.response.status} ${JSON.stringify(sent.response.json ?? sent.response.text.slice(0, 70))?.slice(0, 110)}`,
      response: sent.response,
    };
  } catch (err) {
    return { outcome: 'FAIL', reasons: [`threw: ${String(err?.message ?? err).slice(0, 200)}`], detail: 'threw' };
  } finally {
    capture.restore();
    upstream.restore();
    env.DB?.close?.();
    env.SURVEY_DB?.close?.();
    env.SURVEY_SYMPTOMS_DB?.close?.();
    env.ANALYTICS_DB?.close?.();
  }
}

async function runLiveCase(kase, options) {
  if (kase.live?.skip) return { outcome: 'SKIP', reasons: [kase.live.skip], detail: kase.live.skip };
  if (kase.scenario) return { outcome: 'SKIP', reasons: ['scenario cases are hermetic only'], detail: 'hermetic only' };
  if (!kase.live?.expect) return { outcome: 'SKIP', reasons: ['no live expectation declared for this case'], detail: 'no live expectation' };

  const sent = await sendLive(kase, options);
  if (sent.skipReason) return { outcome: 'SKIP', reasons: [sent.skipReason], detail: sent.skipReason };
  if (sent.error) return { outcome: 'FAIL', reasons: [`request failed: ${sent.error}`], detail: sent.error };

  const reasons = [
    ...evaluate(kase, { ...sent, expectOverride: kase.live.expect }),
    ...universalLeakCheck(sent.response),
  ];
  return {
    outcome: reasons.length ? 'FAIL' : 'PASS',
    reasons,
    detail: `${sent.response.status} ${JSON.stringify(sent.response.json ?? sent.response.text.slice(0, 60))?.slice(0, 100)}`,
    response: sent.response,
  };
}

export async function run(options) {
  const selected = options.families ? CASES.filter((kase) => options.families.has(kase.family)) : CASES;
  const results = [];

  for (const kase of selected) {
    const result = options.mode === 'live' ? await runLiveCase(kase, options) : await runHermeticCase(kase, options);
    /* An adjudicated failure is KNOWN, never PASS: the grid keeps printing it
       and the run stays green enough to gate a PR. */
    const outcome = result.outcome === 'FAIL' && kase.known ? 'KNOWN' : result.outcome;
    results.push({ ...kase, ...result, outcome, expect: kase.expect ?? null });
  }

  return results;
}

// --------------------------------------------------------------------------
// Output.
// --------------------------------------------------------------------------

export function tally(results) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, KNOWN: 0 };
  for (const result of results) counts[result.outcome] += 1;
  return counts;
}

export function grid(results, { verbose = false } = {}) {
  const lines = [];
  const byFamily = new Map();
  for (const result of results) {
    if (!byFamily.has(result.family)) byFamily.set(result.family, []);
    byFamily.get(result.family).push(result);
  }

  for (const [family, rows] of byFamily) {
    const counts = tally(rows);
    lines.push('');
    lines.push(`${family.toUpperCase()}  ${FAMILIES[family] ?? ''}`);
    lines.push(`  ${rows.length} cases: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.KNOWN} KNOWN, ${counts.SKIP} SKIP`);
    for (const row of rows) {
      if (!verbose && row.outcome === 'PASS') continue;
      lines.push(`  ${row.outcome.padEnd(5)} ${row.id}`);
      if (row.scenario) lines.push(`        measured: ${row.detail}`);
      for (const reason of row.reasons ?? []) lines.push(`        ${reason}`);
    }
  }

  const total = tally(results);
  lines.push('');
  lines.push(`TOTAL ${results.length} cases: ${total.PASS} PASS, ${total.FAIL} FAIL, ${total.KNOWN} KNOWN, ${total.SKIP} SKIP`);
  return lines.join('\n');
}

function markdown(results, options) {
  const total = tally(results);
  const lines = [
    `# Red-team run: ${options.mode}`,
    '',
    `Run ${new Date().toISOString()} against ${options.mode === 'live' ? options.base : 'the Pages Functions in process'}.`,
    '',
    `**${results.length} cases: ${total.PASS} PASS, ${total.FAIL} FAIL, ${total.KNOWN} KNOWN, ${total.SKIP} SKIP.**`,
    '',
    '| Family | Cases | PASS | FAIL | KNOWN | SKIP |',
    '|---|---:|---:|---:|---:|---:|',
  ];

  for (const family of [...new Set(results.map((r) => r.family))]) {
    const rows = results.filter((r) => r.family === family);
    const counts = tally(rows);
    lines.push(`| ${family} | ${rows.length} | ${counts.PASS} | ${counts.FAIL} | ${counts.KNOWN} | ${counts.SKIP} |`);
  }

  const notable = results.filter((r) => r.outcome === 'FAIL' || r.outcome === 'KNOWN');
  lines.push('', '## Findings and adjudicated failures', '');
  if (!notable.length) lines.push('None. Every case answered what the table says it must.');
  for (const result of notable) {
    lines.push(`### ${result.outcome}: ${result.id}${result.known ? ` (${result.known})` : ''}`);
    lines.push('');
    lines.push(`- ${result.description}`);
    lines.push(`- Request: \`${`${result.method ?? 'GET'} ${result.path}${result.query ?? ''}`.slice(0, 200)}\` as \`${result.as}\` at \`${result.host}\``);
    lines.push(`- Response: ${result.detail}`);
    for (const reason of result.reasons ?? []) lines.push(`- Mismatch: ${reason}`);
    if (result.knownNote) lines.push(`- Adjudication: ${result.knownNote}`);
    lines.push('');
  }

  const skipped = results.filter((r) => r.outcome === 'SKIP');
  if (skipped.length) {
    lines.push('## Skipped, and why', '');
    const byReason = new Map();
    for (const result of skipped) {
      const reason = result.reasons?.[0] ?? 'no reason given';
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason).push(result.id);
    }
    for (const [reason, ids] of byReason) lines.push(`- ${ids.length} cases: ${reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

function writeReport(results, options) {
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = join(ROOT, 'docs', 'redteam', `${date}-${options.mode}.md`);
  mkdirSync(dirname(mdPath), { recursive: true });
  /* Exactly one trailing newline. The section builders end with a blank line
     so the sections separate; without this trim the file ends in a blank line
     and `git diff --check` refuses the commit. */
  writeFileSync(mdPath, `${markdown(results, options).replace(/\s+$/, '')}\n`);
  return { mdPath };
}

if (import.meta.filename === process.argv[1]) {
  const options = parseArgs(process.argv.slice(2));
  const results = await run(options);
  console.log(grid(results, { verbose: options.verbose }));
  if (options.report) {
    const { mdPath } = writeReport(results, options);
    console.log(`\nreport: ${mdPath}`);
  }
  process.exit(tally(results).FAIL > 0 ? 1 : 0);
}

export { IDENTITIES, HOSTS, countByFamily };
