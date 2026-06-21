import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil } from './_helpers.js';
import { sendTracked } from '../functions/api/newsletter/_mail.js';

describe('sendTracked', () => {
  it('success: returns {ok:true,messageId} and logs the sent event', async () => {
    const sentCalls = [];
    const logFailureCalls = [];
    const eventPoints = [];

    const sendEmailFn = async (_env, opts) => {
      sentCalls.push(opts);
      return { messageId: 'msg-abc-123' };
    };
    const logEmailFailureFn = async (_db, row) => { logFailureCalls.push(row); };

    const env = mockEnv({
      EVENTS: { writeDataPoint(d) { eventPoints.push(d); } },
    });
    const waitUntil = mockWaitUntil();

    const result = await sendTracked(
      env,
      waitUntil,
      { from: 'a@b.com', to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' },
      { component: 'welcome', category: 'newsletter', source: 'newsletter/welcome' },
      { sendEmail: sendEmailFn, logEmailFailure: logEmailFailureFn }
    );

    assert.deepEqual(result, { ok: true, messageId: 'msg-abc-123' });
    assert.equal(sentCalls.length, 1, 'sendEmail must be called once');
    assert.equal(sentCalls[0].to, 'user@example.com');
    assert.equal(sentCalls[0].log.category, 'newsletter');
    assert.equal(sentCalls[0].log.source, 'newsletter/welcome');
    assert.equal(logFailureCalls.length, 0, 'logEmailFailure must not be called on success');
    const sentEvent = eventPoints.find(d => d.blobs?.includes('welcome_sent'));
    assert.ok(sentEvent, 'success must be logged via EVENTS');
  });

  it('failure: sendEmail throws -> returns {ok:false}, calls logEmailFailure (email_log), fires Telegram fetch, never throws', async () => {
    const logFailureCalls = [];
    const fetchCalls = [];
    const eventPoints = [];

    const sendEmailFn = async () => { throw new Error('SES 500'); };
    const logEmailFailureFn = async (_db, row) => { logFailureCalls.push(row); };
    const fetchFn = async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true }; };

    const env = mockEnv({
      TELEGRAM_BOT_TOKEN: 'bot-token-123',
      TELEGRAM_CHAT_ID: 'chat-456',
      EVENTS: { writeDataPoint(d) { eventPoints.push(d); } },
    });
    const waitUntil = mockWaitUntil();

    let result;
    await assert.doesNotReject(async () => {
      result = await sendTracked(
        env,
        waitUntil,
        { from: 'a@b.com', to: 'fail@example.com', subject: 'Test', text: 'x' },
        { component: 'welcome', category: 'newsletter', source: 'newsletter/welcome' },
        { sendEmail: sendEmailFn, logEmailFailure: logEmailFailureFn, fetch: fetchFn }
      );
    }, 'sendTracked must never throw to caller');

    assert.equal(result.ok, false);
    assert.ok(result.error, 'error field must be present');

    assert.equal(logFailureCalls.length, 1, 'logEmailFailure must be called once');
    assert.equal(logFailureCalls[0].email, 'fail@example.com');
    assert.equal(logFailureCalls[0].category, 'newsletter');
    assert.ok(logFailureCalls[0].detail?.includes('SES 500'));

    assert.equal(fetchCalls.length, 1, 'Telegram fetch must be called once');
    assert.ok(fetchCalls[0].url.includes('sendMessage'));
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.chat_id, 'chat-456');
    assert.ok(body.text.includes('welcome'));
    assert.ok(body.text.includes('fail@example.com'));

    const failEvent = eventPoints.find(d => d.blobs?.includes('welcome_failed'));
    assert.ok(failEvent, 'failure must be logged via EVENTS');
  });

  it('no-telegram-envs: alertFailure is a no-op when TELEGRAM_* envs are absent', async () => {
    const fetchCalls = [];
    const fetchFn = async (url, opts) => { fetchCalls.push({ url, opts }); return { ok: true }; };
    const sendEmailFn = async () => { throw new Error('SES gone'); };
    const logEmailFailureFn = async () => {};

    const env = mockEnv({});
    const waitUntil = mockWaitUntil();

    await sendTracked(
      env,
      waitUntil,
      { from: 'a@b.com', to: 'x@y.com', subject: 'S', text: 't' },
      { component: 'test', category: 'transactional', source: 'test/source' },
      { sendEmail: sendEmailFn, logEmailFailure: logEmailFailureFn, fetch: fetchFn }
    );

    assert.equal(fetchCalls.length, 0, 'Telegram fetch must NOT be called when envs are absent');
  });

  it('logEmailFailure-throws: if email_log insert fails, sendTracked still returns {ok:false} without throwing', async () => {
    const sendEmailFn = async () => { throw new Error('SES error'); };
    const logEmailFailureFn = async () => { throw new Error('D1 dead'); };

    const env = mockEnv({});
    const waitUntil = mockWaitUntil();

    let result;
    await assert.doesNotReject(async () => {
      result = await sendTracked(
        env,
        waitUntil,
        { from: 'a@b.com', to: 'x@y.com', subject: 'S', text: 't' },
        { component: 'test', category: 'transactional', source: 'test/source' },
        { sendEmail: sendEmailFn, logEmailFailure: logEmailFailureFn }
      );
    }, 'logEmailFailure throw must be swallowed');

    assert.equal(result.ok, false);
  });
});
