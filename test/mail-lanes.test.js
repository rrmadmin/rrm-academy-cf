/**
 * Executed tests for functions/api/_mail-lanes.js -- the M365/Workspace
 * dual-lane transactional email router.
 *
 * isM365Recipient() and sendTransactionalEmail() share module-scope caches
 * (domain MX cache, Workspace access-token cache) that persist for the life
 * of this file's process. Every test below uses a domain/recipient unique to
 * that test so a cache hit from an earlier test can never substitute for the
 * fetch call the assertion is actually checking.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockDB } from './_helpers.js';
import { isM365Recipient, sendTransactionalEmail, sendViaWorkspace } from '../functions/api/_mail-lanes.js';

const WORKSPACE_ENV = {
  GOG_CLIENT_ID: 'client-id-test',
  GOG_CLIENT_SECRET: 'client-secret-test',
  VA_GMAIL_REFRESH_TOKEN: 'refresh-token-test',
};

/**
 * Replaces globalThis.fetch with a router over the four external hosts
 * _mail-lanes.js talks to. Mirrors test/_helpers.js's stubExternalFetch, but
 * scoped to this file's own routes rather than the app-wide set.
 */
function stubMailLaneFetch(overrides = {}) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init) => {
    const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const call = { url, init };
    calls.push(call);

    if (url.includes('cloudflare-dns.com')) {
      call.service = 'dns';
      if (overrides.dns) return overrides.dns(call);
      return { ok: true, json: async () => ({ Answer: [] }) };
    }
    if (url.includes('oauth2.googleapis.com')) {
      call.service = 'token';
      if (overrides.token) return overrides.token(call);
      return { ok: true, json: async () => ({ access_token: 'workspace-access-token', expires_in: 3600 }) };
    }
    if (url.includes('gmail.googleapis.com')) {
      call.service = 'gmail';
      if (overrides.gmail) return overrides.gmail(call);
      return { ok: true, json: async () => ({ id: 'gmail-msg-default' }) };
    }
    if (url.includes('amazonaws.com')) {
      call.service = 'ses';
      if (overrides.ses) return overrides.ses(call);
      return { ok: true, status: 200, json: async () => ({ MessageId: 'ses-msg-default' }), text: async () => '{}' };
    }

    call.service = 'unrouted';
    throw new Error(`stubMailLaneFetch: unrouted request to ${url}`);
  };

  return {
    calls,
    get dns() { return calls.filter((c) => c.service === 'dns'); },
    get token() { return calls.filter((c) => c.service === 'token'); },
    get gmail() { return calls.filter((c) => c.service === 'gmail'); },
    get ses() { return calls.filter((c) => c.service === 'ses'); },
    restore() { globalThis.fetch = original; },
  };
}

function mxAnswer(target) {
  return { ok: true, json: async () => ({ Answer: [{ data: `10 ${target}` }] }) };
}

/** Decodes a Gmail API call's base64url `raw` MIME body and returns the From: header value. */
function fromHeaderOf(gmailCall) {
  const { raw } = JSON.parse(gmailCall.init.body);
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const match = decoded.match(/^From: (.+)\r?$/m);
  return match ? match[1].trim() : null;
}

describe('isM365Recipient', () => {
  it('returns false for an address with no @', async () => {
    const stub = stubMailLaneFetch();
    try {
      assert.equal(await isM365Recipient('not-an-email'), false);
      assert.equal(stub.dns.length, 0, 'a malformed address must never reach DNS');
    } finally { stub.restore(); }
  });

  it('true when an MX answer targets Microsoft 365 Exchange Online Protection', async () => {
    const domain = 'iso-m365-basic.test';
    const stub = stubMailLaneFetch({
      dns: (call) => (call.url.includes(domain)
        ? mxAnswer('rrm-example-com.mail.protection.outlook.com.')
        : { ok: true, json: async () => ({ Answer: [] }) }),
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), true);
    } finally { stub.restore(); }
  });

  it('false when the MX answer targets a non-M365 mail server', async () => {
    const domain = 'iso-nonm365-basic.test';
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('mx.somehostingco.example.com.'),
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), false);
    } finally { stub.restore(); }
  });

  it('tolerates a trailing dot and mixed case on the MX target', async () => {
    const domain = 'iso-trailingdot.test';
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('TENANT.MAIL.PROTECTION.OUTLOOK.COM.'),
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), true);
    } finally { stub.restore(); }
  });

  it('false on a malformed DNS response (no Answer array)', async () => {
    const domain = 'iso-malformed.test';
    const stub = stubMailLaneFetch({
      dns: () => ({ ok: true, json: async () => ({ Question: [] }) }),
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), false);
    } finally { stub.restore(); }
  });

  it('false when the DoH endpoint answers non-2xx', async () => {
    const domain = 'iso-notok.test';
    const stub = stubMailLaneFetch({
      dns: () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), false);
    } finally { stub.restore(); }
  });

  it('false on a network error (fails toward SES, never blocks a send)', async () => {
    const domain = 'iso-networkerror.test';
    const stub = stubMailLaneFetch({
      dns: () => { throw new Error('getaddrinfo ENOTFOUND'); },
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), false);
    } finally { stub.restore(); }
  });

  it('false on a timeout (AbortError from the fetch layer)', async () => {
    const domain = 'iso-timeout.test';
    const stub = stubMailLaneFetch({
      dns: () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; },
    });
    try {
      assert.equal(await isM365Recipient(`user@${domain}`), false);
    } finally { stub.restore(); }
  });

  it('caches a domain result -- a second lookup does not re-hit DNS', async () => {
    const domain = 'iso-cache-check.test';
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('tenant.mail.protection.outlook.com.'),
    });
    try {
      assert.equal(await isM365Recipient(`first@${domain}`), true);
      assert.equal(stub.dns.length, 1);
      assert.equal(await isM365Recipient(`second@${domain}`), true, 'same domain, different local part');
      assert.equal(stub.dns.length, 1, 'the second lookup must be served from cache');
    } finally { stub.restore(); }
  });
});

describe('sendViaWorkspace -- per-caller From identity map', () => {
  it('accounts@ local-part maps to the registered receipts@ identity', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@identity-map-accounts.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(stub.gmail.length, 1);
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <receipts@rrmacademy.org>');
    } finally { stub.restore(); }
  });

  it('a bare address with no display name still maps by local-part', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: 'accounts@mail.rrmacademy.org',
        to: 'user@identity-map-bare.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <receipts@rrmacademy.org>');
    } finally { stub.restore(); }
  });

  it('survey@ local-part (not in the map) falls back to the surveys@ default', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: 'RRM Academy <survey@mail.rrmacademy.org>',
        to: 'user@identity-map-survey.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <surveys@rrmacademy.org>');
    } finally { stub.restore(); }
  });

  it('an unmapped but well-formed local-part falls back to the surveys@ default', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: 'RRM Academy <alerts@mail.rrmacademy.org>',
        to: 'user@identity-map-unknown.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <surveys@rrmacademy.org>');
    } finally { stub.restore(); }
  });

  it('a malformed from (no @ at all) falls back to the surveys@ default', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: 'not an email address at all',
        to: 'user@identity-map-malformed.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <surveys@rrmacademy.org>');
    } finally { stub.restore(); }
  });

  it('an empty/missing from falls back to the surveys@ default', async () => {
    const env = mockEnv({ ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch();
    try {
      await sendViaWorkspace(env, {
        from: undefined,
        to: 'user@identity-map-empty.test',
        subject: 'Test subject',
        text: 'Hello',
      });
      assert.equal(fromHeaderOf(stub.gmail[0]), 'RRM Academy <surveys@rrmacademy.org>');
    } finally { stub.restore(); }
  });
});

describe('sendTransactionalEmail -- routing decisions', () => {
  it('missing Workspace secrets -> routes straight to SES, never touches DNS/token/Gmail', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db }); // no GOG_* keys
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('tenant.mail.protection.outlook.com.'), // would be M365 if ever checked
    });
    try {
      const result = await sendTransactionalEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@route-secrets-missing.test',
        subject: 'Test subject',
        text: 'Hello',
        log: { db, category: 'transactional', source: 'test/mail-lanes' },
      });
      assert.equal(stub.dns.length, 0, 'no secrets configured must short-circuit before any MX check');
      assert.equal(stub.token.length, 0);
      assert.equal(stub.gmail.length, 0);
      assert.equal(stub.ses.length, 1);
      assert.equal(result.messageId, 'ses-msg-default');

      const sendRow = db._calls.find((c) => c.sql.includes('INSERT INTO email_log'));
      assert.ok(sendRow, 'sendEmail must still log its own send row');
      assert.equal(sendRow.bound[0], 'send');
      assert.equal(sendRow.bound[8], 'ses', 'lane column defaults to ses');
    } finally { stub.restore(); }
  });

  it('array recipient -> routes straight to SES even with Workspace configured', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db, ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('tenant.mail.protection.outlook.com.'),
    });
    try {
      const result = await sendTransactionalEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: ['a@route-array.test', 'b@route-array.test'],
        subject: 'Test subject',
        text: 'Hello',
        log: { db, category: 'transactional', source: 'test/mail-lanes' },
      });
      assert.equal(stub.dns.length, 0, 'an array recipient must never reach isM365Recipient');
      assert.equal(stub.token.length, 0);
      assert.equal(stub.gmail.length, 0);
      assert.equal(stub.ses.length, 1);
      assert.equal(result.messageId, 'ses-msg-default');
    } finally { stub.restore(); }
  });

  it('non-M365 recipient -> routes to SES directly (no Gmail attempt)', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db, ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('mx.somehostingco.example.com.'),
    });
    try {
      const result = await sendTransactionalEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@route-nonm365.test',
        subject: 'Test subject',
        text: 'Hello',
        log: { db, category: 'transactional', source: 'test/mail-lanes' },
      });
      assert.equal(stub.dns.length, 1);
      assert.equal(stub.gmail.length, 0);
      assert.equal(stub.ses.length, 1);
      assert.equal(result.messageId, 'ses-msg-default');

      const sendRow = db._calls.find((c) => c.sql.includes('INSERT INTO email_log'));
      assert.equal(sendRow.bound[8], 'ses');
    } finally { stub.restore(); }
  });

  it('M365 recipient -> sends via Workspace and logs the send under lane "workspace"', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db, ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('tenant.mail.protection.outlook.com.'),
      gmail: () => ({ ok: true, json: async () => ({ id: 'gmail-msg-success-1' }) }),
    });
    try {
      const result = await sendTransactionalEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@route-m365-success.test',
        subject: 'Test subject',
        html: '<p>Hello</p>',
        text: 'Hello',
        log: { db, category: 'transactional', source: 'test/mail-lanes' },
      });
      assert.equal(stub.dns.length, 1);
      assert.equal(stub.gmail.length, 1);
      assert.equal(stub.ses.length, 0, 'a successful Workspace send must never fall back to SES');
      assert.equal(result.messageId, 'gmail-msg-success-1');

      const sendRow = db._calls.find((c) => c.sql.includes('INSERT INTO email_log'));
      assert.ok(sendRow);
      assert.equal(sendRow.bound[0], 'send');
      assert.equal(sendRow.bound[6], 'gmail-msg-success-1', 'send_id carries the Gmail message id');
      assert.equal(sendRow.bound[7], null, 'ses_message_id must be null on the workspace lane');
      assert.equal(sendRow.bound[8], 'workspace');
      assert.match(sendRow.bound[5], /^gmail:gmail-msg-success-1$/, 'detail records gmail:<id>');
    } finally { stub.restore(); }
  });

  it('Workspace send failure -> logs lane_fallback, then falls back to SES', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db, ...WORKSPACE_ENV });
    const stub = stubMailLaneFetch({
      dns: () => mxAnswer('tenant.mail.protection.outlook.com.'),
      gmail: () => ({ ok: false, status: 500, text: async () => 'internal error' }),
      ses: () => ({ ok: true, status: 200, json: async () => ({ MessageId: 'ses-fallback-msg' }), text: async () => '{}' }),
    });
    try {
      const result = await sendTransactionalEmail(env, {
        from: 'RRM Academy <accounts@mail.rrmacademy.org>',
        to: 'user@route-m365-fallback.test',
        subject: 'Test subject',
        text: 'Hello',
        log: { db, category: 'transactional', source: 'test/mail-lanes' },
      });
      assert.equal(stub.gmail.length, 1);
      assert.equal(stub.ses.length, 1, 'a failed Workspace send must fall through to SES');
      assert.equal(result.messageId, 'ses-fallback-msg', 'the final result is the SES send that actually succeeded');

      const logRows = db._calls.filter((c) => c.sql.includes('INSERT INTO email_log'));
      const fallbackRow = logRows.find((r) => r.bound[0] === 'lane_fallback');
      assert.ok(fallbackRow, 'a lane_fallback row must be written before the SES retry');
      assert.equal(fallbackRow.bound[8], 'workspace');
      assert.match(fallbackRow.bound[5], /Gmail send failed \(500\)/);

      const sesRow = logRows.find((r) => r.bound[0] === 'send');
      assert.ok(sesRow, 'the SES fallback send must log its own send row');
      assert.equal(sesRow.bound[8], 'ses');
      assert.equal(sesRow.bound[6], 'ses-fallback-msg');
    } finally { stub.restore(); }
  });

  it('sendTransactionalEmail throws when the final lane attempt throws (SES down, no Workspace configured)', async () => {
    const db = mockDB();
    const env = mockEnv({ DB: db });
    const stub = stubMailLaneFetch({
      ses: () => ({ ok: false, status: 400, text: async () => 'MessageRejected' }),
    });
    try {
      await assert.rejects(
        () => sendTransactionalEmail(env, {
          from: 'RRM Academy <accounts@mail.rrmacademy.org>',
          to: 'user@route-throws.test',
          subject: 'Test subject',
          text: 'Hello',
          log: { db, category: 'transactional', source: 'test/mail-lanes' },
        }),
        /SES request failed/
      );
    } finally { stub.restore(); }
  });
});
