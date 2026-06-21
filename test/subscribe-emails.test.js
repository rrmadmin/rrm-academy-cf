import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil } from './_helpers.js';
import { sendSignupEmails } from '../functions/api/newsletter/_signup-emails.js';

function makeSpies() {
  const sendEmailCalls = [];
  const sendRawEmailCalls = [];

  const ses = {
    sendEmail: async (env, opts) => {
      sendEmailCalls.push(opts);
    },
    sendRawEmail: async (env, opts) => {
      sendRawEmailCalls.push(opts);
    },
  };

  const tracking = {
    unsubscribeUrl: async (email, secret) =>
      `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=testtoken&b=2026Q2`,
    unsubscribeHeaders: async (email, secret) => ({
      'List-Unsubscribe': `<https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=testtoken&b=2026Q2>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }),
  };

  return { ses, tracking, sendEmailCalls, sendRawEmailCalls };
}

async function drainWaitUntil(waitUntil) {
  await Promise.allSettled(waitUntil.promises);
}

describe('sendSignupEmails', () => {
  it('admin-recipient: admin notification is addressed to administrator@rrmacademy.org with subject "New newsletter subscriber"', async () => {
    const { ses, tracking, sendEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendEmailCalls.length, 1);
    assert.equal(sendEmailCalls[0].to, 'administrator@rrmacademy.org');
    assert.equal(sendEmailCalls[0].subject, 'New newsletter subscriber');
    assert.ok(sendEmailCalls[0].text.includes('jane@example.com'));
    assert.ok(sendEmailCalls[0].text.includes('source: website'));
  });

  it('welcome-unsub-url: the welcome text contains the unsubscribe URL', async () => {
    const { ses, tracking, sendRawEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendRawEmailCalls.length, 1);
    const text = sendRawEmailCalls[0].text;
    assert.ok(
      text.includes('/api/newsletter/unsubscribe'),
      `Expected text to contain unsubscribe URL but got: ${text.slice(-200)}`
    );
  });

  it('welcome-unsub-headers: sendRawEmail receives List-Unsubscribe AND List-Unsubscribe-Post headers', async () => {
    const { ses, tracking, sendRawEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendRawEmailCalls.length, 1);
    const headers = sendRawEmailCalls[0].headers;
    assert.ok(headers['List-Unsubscribe'], 'Missing List-Unsubscribe header');
    assert.ok(headers['List-Unsubscribe-Post'], 'Missing List-Unsubscribe-Post header');
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(headers['List-Unsubscribe'].includes('/api/newsletter/unsubscribe'));
  });

  it('no-secret-skips-welcome: with NEWSLETTER_SECRET unset, sendRawEmail is NOT called but admin notify still attempted', async () => {
    const { ses, tracking, sendEmailCalls, sendRawEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: undefined });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendRawEmailCalls.length, 0, 'sendRawEmail should NOT be called when NEWSLETTER_SECRET is missing');
    assert.equal(sendEmailCalls.length, 1, 'admin sendEmail should still be attempted');
  });

  it('failure-swallowed: an SES function that throws does not propagate out of sendSignupEmails', async () => {
    const throwingSes = {
      sendEmail: async () => { throw new Error('SES exploded'); },
      sendRawEmail: async () => { throw new Error('SES raw exploded'); },
    };
    const throwingTracking = {
      unsubscribeUrl: async () => { throw new Error('tracking exploded'); },
      unsubscribeHeaders: async () => { throw new Error('tracking exploded'); },
    };
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', throwingSes, throwingTracking);

    await assert.doesNotReject(
      () => drainWaitUntil(waitUntil),
      'Failures inside sendSignupEmails must not propagate'
    );
  });
});
