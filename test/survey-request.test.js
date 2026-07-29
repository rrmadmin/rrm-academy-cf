/**
 * Executed tests for POST /api/survey/request (functions/api/survey/request.js).
 * 0/183 lines before this file: nothing anywhere imported the survey endpoints.
 *
 * This is the front door of the national endometriosis self-survey -- the
 * dataset behind federal grant claims. The two behaviours worth the most here:
 *
 *   1. The magic-link token is the ONLY thing that carries identity forward.
 *      The email lives in KV under `email:<address>` (rate limit) and inside
 *      the `token:<uuid>` record; nothing else in the request path stores it.
 *   2. If the email send fails, BOTH KV keys are deleted. Without that rollback
 *      a person who never received a link would be locked out for 10 minutes
 *      by their own failed attempt, and a live token would exist that no one
 *      can use.
 *
 * All external I/O (Cloudflare DoH MX lookup, EmailListVerify, SES, GA4) is
 * routed through stubExternalFetch so every assertion is about this endpoint's
 * behaviour, never about a mock.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../functions/api/survey/request.js';
import {
  mockRequest, mockEnv, mockKVJson, mockWaitUntil, parseResponse, randomIp, stubExternalFetch, drainWaitUntil,
} from './_helpers.js';

const TOKEN_TTL = 24 * 60 * 60;
const RATE_LIMIT_SECONDS = 600;

function makeContext({ body = { email: 'taker@example.com' }, rawBody, url, ip = randomIp(), env: envOverrides = {}, headers = {} } = {}) {
  const env = mockEnv({ SURVEY_TOKENS: mockKVJson(), ...envOverrides });
  const waitUntil = mockWaitUntil();
  return {
    env,
    waitUntil,
    request: mockRequest('POST', {
      body,
      rawBody,
      url: url || 'https://rrmacademy.org/api/survey/request',
      headers: { 'CF-Connecting-IP': ip, ...headers },
    }),
  };
}

/** Pulls the minted token out of the KV write log (the endpoint never returns it). */
function mintedToken(env) {
  const put = env.SURVEY_TOKENS.puts.find(p => p.key.startsWith('token:'));
  return put ? put.key.slice('token:'.length) : null;
}

/**
 * Runs the handler and settles its fire-and-forget work before returning.
 * Draining inside the test matters: the GA4 beacon is handed to waitUntil, and
 * an undrained promise would resolve against the NEXT test's fetch stub and be
 * miscounted there.
 */
async function run(ctx) {
  const res = await onRequestPost(ctx);
  await drainWaitUntil(ctx.waitUntil);
  return parseResponse(res);
}

describe('survey/request -- CORS preflight', () => {
  it('answers OPTIONS with 204 and the locked-down origin', async () => {
    const res = await onRequestOptions();
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://rrmacademy.org');
  });
});

describe('survey/request -- configuration guards', () => {
  it('refuses with 500 when the token KV namespace is not bound', async () => {
    const ctx = makeContext({ env: { SURVEY_TOKENS: undefined } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 500);
      assert.deepEqual(parsed.body, { ok: false, error: 'Server misconfigured' });
      assert.equal(stub.ses.length, 0, 'must not attempt a send with no token store');
    } finally { stub.restore(); }
  });

  it('refuses with 500 when SES credentials are absent', async () => {
    const ctx = makeContext({ env: { AWS_ACCESS_KEY_ID: undefined } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 500);
      assert.deepEqual(parsed.body, { ok: false, error: 'Server misconfigured' });
      assert.equal(ctx.env.SURVEY_TOKENS.puts.length, 0, 'must not mint a token it cannot deliver');
    } finally { stub.restore(); }
  });
});

describe('survey/request -- payload validation', () => {
  it('rejects a body that is not JSON', async () => {
    const ctx = makeContext({ rawBody: '{"email": ' });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'Invalid JSON');
    } finally { stub.restore(); }
  });

  it('rejects a JSON array payload', async () => {
    const ctx = makeContext({ rawBody: '[{"email":"a@b.com"}]' });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.error, 'Invalid payload');
    } finally { stub.restore(); }
  });

  it('rejects a missing email', async () => {
    const ctx = makeContext({ body: {} });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.match(parsed.body.error, /email is required/);
    } finally { stub.restore(); }
  });

  it('rejects a structurally invalid email before any network call', async () => {
    const ctx = makeContext({ body: { email: 'not-an-email' } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.equal(stub.calls.length, 0, 'a malformed address must not reach DNS/ELV/SES');
    } finally { stub.restore(); }
  });

  it('rejects a disposable address with the deep-validator message', async () => {
    const ctx = makeContext({ body: { email: 'throwaway@mailinator.com' } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.match(parsed.body.error, /Disposable email addresses are not allowed/);
      assert.equal(stub.ses.length, 0);
      assert.equal(ctx.env.SURVEY_TOKENS.puts.length, 0);
    } finally { stub.restore(); }
  });
});

describe('survey/request -- abuse controls', () => {
  it('rate-limits a single IP after 5 attempts in the window', async () => {
    const ip = randomIp();
    const env = mockEnv({ SURVEY_TOKENS: mockKVJson() });
    const stub = stubExternalFetch();
    try {
      const statuses = [];
      for (let i = 0; i < 6; i++) {
        const waitUntil = mockWaitUntil();
        const res = await onRequestPost({
          env,
          waitUntil,
          // A distinct address each time so the per-address cooldown is not
          // what trips: this must be the per-IP limiter.
          request: mockRequest('POST', {
            body: { email: `taker${i}@example.com` },
            url: 'https://rrmacademy.org/api/survey/request',
            headers: { 'CF-Connecting-IP': ip },
          }),
        });
        await drainWaitUntil(waitUntil);
        statuses.push((await parseResponse(res)).status);
      }
      assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
      assert.equal(statuses[5], 429, 'the 6th attempt from one IP must be refused');
    } finally { stub.restore(); }
  });

  it('refuses a repeat request for the same address inside the 10-minute cooldown', async () => {
    const email = 'repeat@example.com';
    const ctx = makeContext({ body: { email } });
    ctx.env.SURVEY_TOKENS._store.set(`email:${email}`, JSON.stringify({ token: 'prev', created: Date.now() - 60_000 }));
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 429);
      assert.match(parsed.body.error, /Check your inbox/);
      assert.equal(stub.ses.length, 0, 'cooldown must suppress the second send');
      assert.equal(mintedToken(ctx.env), null, 'cooldown must not mint a second token');
    } finally { stub.restore(); }
  });

  it('allows a repeat request once the cooldown has elapsed', async () => {
    const email = 'repeat-ok@example.com';
    const ctx = makeContext({ body: { email } });
    ctx.env.SURVEY_TOKENS._store.set(
      `email:${email}`,
      JSON.stringify({ token: 'prev', created: Date.now() - (RATE_LIMIT_SECONDS + 5) * 1000 })
    );
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.ok(mintedToken(ctx.env), 'a fresh token should be minted after the cooldown');
    } finally { stub.restore(); }
  });

  it('blocks an address EmailListVerify flags as a spamtrap', async () => {
    const ctx = makeContext({ body: { email: 'trap@example.com' } });
    const stub = stubExternalFetch({ elv: () => ({ ok: true, text: async () => 'spamtrap' }) });
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.match(parsed.body.error, /cannot be used/);
      assert.equal(stub.ses.length, 0);
      assert.equal(mintedToken(ctx.env), null);
    } finally { stub.restore(); }
  });
});

describe('survey/request -- magic-link mint and delivery', () => {
  it('stores the token record, the reverse lookup, and mails a link carrying that token', async () => {
    const email = 'taker@example.com';
    const ctx = makeContext({ body: { email } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.deepEqual(parsed.body, { ok: true });

      const token = mintedToken(ctx.env);
      assert.match(token, /^[0-9a-f-]{36}$/, 'token must be a UUID');

      // Forward record: token -> identity, unused, 24h TTL.
      const record = ctx.env.SURVEY_TOKENS.read(`token:${token}`);
      assert.equal(record.email, email);
      assert.equal(record.used, false);
      assert.equal(typeof record.created, 'number');
      const tokenPut = ctx.env.SURVEY_TOKENS.puts.find(p => p.key === `token:${token}`);
      assert.equal(tokenPut.opts.expirationTtl, TOKEN_TTL);

      // Reverse record: address -> token, expires with the cooldown itself, so
      // the cooldown cannot outlive its own KV entry.
      const reverse = ctx.env.SURVEY_TOKENS.read(`email:${email}`);
      assert.equal(reverse.token, token);
      const reversePut = ctx.env.SURVEY_TOKENS.puts.find(p => p.key === `email:${email}`);
      assert.equal(reversePut.opts.expirationTtl, RATE_LIMIT_SECONDS);

      // Exactly one email, to the requester, containing exactly that token.
      assert.equal(stub.ses.length, 1);
      const send = stub.ses[0].body;
      assert.deepEqual(send.Destination.ToAddresses, [email]);
      assert.equal(send.FromEmailAddress, 'RRM Academy <survey@mail.rrmacademy.org>');
      assert.equal(send.Content.Simple.Subject.Data, 'Your Endometriosis Symptom Self-Survey');
      const html = send.Content.Simple.Body.Html.Data;
      assert.ok(
        html.includes(`https://rrmacademy.org/endo-survey/take/?token=${token}`),
        'the mailed link must carry the token that was just stored'
      );
    } finally { stub.restore(); }
  });

  it('logs the send against the email_log table', async () => {
    const ctx = makeContext();
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const logInsert = ctx.env.DB._calls.find(c => c.sql.includes('INSERT INTO email_log'));
      assert.ok(logInsert, 'a successful send must be recorded in email_log');
      assert.equal(logInsert.bound[0], 'send');
      assert.equal(logInsert.bound[3], 'survey/request');
    } finally { stub.restore(); }
  });

  it('fires the generate_lead conversion event without leaking the address', async () => {
    const ctx = makeContext({ body: { email: 'lead@example.com' } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      assert.equal(stub.ga4.length, 1);
      const event = stub.ga4[0].body.events[0];
      assert.equal(event.name, 'generate_lead');
      assert.equal(event.params.lead_source, 'endo_survey_request');
      assert.ok(
        !JSON.stringify(stub.ga4[0].body).includes('lead@example.com'),
        'no address may travel to GA4'
      );
    } finally { stub.restore(); }
  });
});

describe('survey/request -- marketing attribution carried onto the token', () => {
  it('prefers query-string userorigin and utm_source and appends both to the link', async () => {
    const ctx = makeContext({
      body: { email: 'utm@example.com', userorigin: 'from-body', utm_source: 'body-src' },
      url: 'https://rrmacademy.org/api/survey/request?userorigin=instagram&utm_source=ig_bio',
    });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const token = mintedToken(ctx.env);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${token}`);
      assert.equal(record.userorigin, 'instagram');
      assert.equal(record.utmSource, 'ig_bio');
      const html = stub.ses[0].body.Content.Simple.Body.Html.Data;
      assert.ok(html.includes('&userorigin=instagram'));
      assert.ok(html.includes('&utm_source=ig_bio'));
    } finally { stub.restore(); }
  });

  it('falls back to the body values when the query string carries none', async () => {
    const ctx = makeContext({ body: { email: 'utm2@example.com', userorigin: 'newsletter', utm_source: 'email' } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${mintedToken(ctx.env)}`);
      assert.equal(record.userorigin, 'newsletter');
      assert.equal(record.utmSource, 'email');
    } finally { stub.restore(); }
  });

  it('drops an over-long marketing tag rather than storing it', async () => {
    const ctx = makeContext({ body: { email: 'utm3@example.com', userorigin: 'x'.repeat(201) } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const record = ctx.env.SURVEY_TOKENS.read(`token:${mintedToken(ctx.env)}`);
      assert.equal(record.userorigin, '');
      assert.ok(!stub.ses[0].body.Content.Simple.Body.Html.Data.includes('userorigin='));
    } finally { stub.restore(); }
  });
});

describe('survey/request -- GA4 identity handoff', () => {
  const cid = '3f2b1a4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';

  it('adopts a valid client id and session id, and carries the cid on the magic link', async () => {
    const ctx = makeContext({ body: { email: 'ga@example.com', ga: { cid, sid: 1738000000, sn: 4 } } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);

      const payload = stub.ga4[0].body;
      assert.equal(payload.client_id, cid, 'the email hop must not split the GA4 user');
      assert.equal(payload.events[0].params.session_id, 1738000000);
      assert.equal(payload.events[0].params.session_number, 4);

      const html = stub.ses[0].body.Content.Simple.Body.Html.Data;
      assert.ok(html.includes(`&cid=${cid}`), 'the take page needs the cid to continue the session');
    } finally { stub.restore(); }
  });

  it('ignores a malformed client id instead of rejecting the request', async () => {
    const ctx = makeContext({ body: { email: 'ga2@example.com', ga: { cid: 'has spaces and $', sid: 1738000000 } } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200, 'bad analytics identity must never fail the survey request');
      assert.notEqual(stub.ga4[0].body.client_id, 'has spaces and $');
      assert.ok(!stub.ses[0].body.Content.Simple.Body.Html.Data.includes('&cid='));
    } finally { stub.restore(); }
  });

  it('ignores an out-of-range session id (cid alone is not enough to override)', async () => {
    const ctx = makeContext({ body: { email: 'ga3@example.com', ga: { cid, sid: 99_999_999_999 } } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      assert.notEqual(stub.ga4[0].body.client_id, cid);
    } finally { stub.restore(); }
  });

  it('accepts a valid cid+sid but drops an out-of-range session number', async () => {
    const ctx = makeContext({ body: { email: 'ga4@example.com', ga: { cid, sid: 1738000000, sn: 0 } } });
    const stub = stubExternalFetch();
    try {
      await run(ctx);
      const params = stub.ga4[0].body.events[0].params;
      assert.equal(stub.ga4[0].body.client_id, cid);
      assert.ok(!('session_number' in params));
    } finally { stub.restore(); }
  });
});

describe('survey/request -- token rollback on delivery failure', () => {
  it('deletes BOTH KV keys and answers 502 when SES rejects the send', async () => {
    const email = 'bounce@example.com';
    const ctx = makeContext({ body: { email } });
    // 400 = SESv2 MessageRejected. Deliberately NOT a 5xx: aws4fetch retries
    // 5xx and 429 up to 11 times with exponential backoff (retries=10,
    // initRetryMs=50), which costs ~40s of wall time here and would do the
    // same inside a live Pages Function. See the tranche notes.
    const stub = stubExternalFetch({
      ses: () => ({ ok: false, status: 400, text: async () => 'MessageRejected' }),
    });
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 502);
      assert.match(parsed.body.error, /Failed to send email/);

      const token = mintedToken(ctx.env);
      assert.ok(token, 'the token was minted before the send, so rollback has something to undo');

      // The rollback is what lets the person retry immediately instead of
      // sitting out a 10-minute cooldown for an email they never received.
      assert.ok(ctx.env.SURVEY_TOKENS.deletes.includes(`email:${email}`));
      assert.ok(ctx.env.SURVEY_TOKENS.deletes.includes(`token:${token}`));
      assert.equal(ctx.env.SURVEY_TOKENS.read(`token:${token}`), null);
      assert.equal(ctx.env.SURVEY_TOKENS.read(`email:${email}`), null);
    } finally { stub.restore(); }
  });

  it('records the failure in email_log so a dropped send is not invisible', async () => {
    const ctx = makeContext({ body: { email: 'bounce2@example.com' } });
    const stub = stubExternalFetch({ ses: () => { throw new Error('socket hang up'); } });
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 502);
      const failLog = ctx.env.DB._calls.filter(c => c.sql.includes('INSERT INTO email_log') && c.bound[0] === 'failed');
      assert.equal(failLog.length, 1);
      assert.equal(failLog[0].bound[3], 'survey/request');
    } finally { stub.restore(); }
  });

  it('answers 502 even when the email_log write also fails', async () => {
    // logEmailFailure is best-effort: a broken email_log must not turn a
    // delivery failure into an unhandled 500.
    const ctx = makeContext({ body: { email: 'bounce3@example.com' } });
    ctx.env.DB = {
      _calls: [],
      prepare() { throw new Error('email_log table missing'); },
    };
    const stub = stubExternalFetch({ ses: () => { throw new Error('SES down'); } });
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 502);
      assert.match(parsed.body.error, /Failed to send email/);
    } finally { stub.restore(); }
  });
});

describe('survey/request -- unexpected failure', () => {
  it('answers a generic 500 when the token store write throws', async () => {
    const ctx = makeContext({ body: { email: 'kvdown@example.com' } });
    ctx.env.SURVEY_TOKENS.put = async () => { throw new Error('KV write failed'); };
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 500);
      assert.equal(parsed.body.error, 'An unexpected error occurred. Please try again.');
      assert.ok(
        !JSON.stringify(parsed.body).includes('KV write failed'),
        'internal error text must not reach the client'
      );
      assert.equal(stub.ses.length, 0);
    } finally { stub.restore(); }
  });
});

describe('survey/request -- production defaults (no env override in play)', () => {
  it('falls back to the "unknown" rate-limit bucket when the edge sends no client IP', async () => {
    // The `|| 'unknown'` arm is the one that runs for any request that reaches
    // the origin without CF-Connecting-IP. Asserted through the KV key the
    // limiter actually writes, not through a mock's return value.
    const communityKv = mockKVJson();
    const ctx = makeContext({ body: { email: 'noip@example.com' }, env: { COMMUNITY_KV: communityKv } });
    ctx.request = mockRequest('POST', {
      body: { email: 'noip@example.com' },
      url: 'https://rrmacademy.org/api/survey/request',
    });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.ok(communityKv._store.has('rl:survey:unknown'), `buckets: ${[...communityKv._store.keys()]}`);
    } finally { stub.restore(); }
  });

  it('returns the corrected address alongside the error when the validator can suggest one', async () => {
    const ctx = makeContext({ body: { email: 'user@gmial.com' } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.equal(parsed.body.suggestion, 'user@gmail.com');
      assert.match(parsed.body.error, /Did you mean/);
    } finally { stub.restore(); }
  });

  it('omits the suggestion key entirely when the validator has none', async () => {
    const ctx = makeContext({ body: { email: 'throwaway@mailinator.com' } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 400);
      assert.ok(!('suggestion' in parsed.body), 'a bare rejection must not carry an empty suggestion');
    } finally { stub.restore(); }
  });

  it('still sends the magic link when no DB is bound to log the send against', async () => {
    const ctx = makeContext({ body: { email: 'nodb@example.com' }, env: { DB: undefined } });
    const stub = stubExternalFetch();
    try {
      const parsed = await run(ctx);
      assert.equal(parsed.status, 200);
      assert.equal(stub.ses.length, 1, 'a missing email_log must not block delivery');
      assert.ok(mintedToken(ctx.env));
    } finally { stub.restore(); }
  });
});
