import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil } from './_helpers.js';
import { sendSignupEmails } from '../functions/api/newsletter/_signup-emails.js';

function makeSpies() {
  const sendEmailCalls = [];

  const ses = {
    sendEmail: async (env, opts) => {
      sendEmailCalls.push(opts);
    },
  };

  const tracking = {
    unsubscribeUrl: async (email, secret) =>
      `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=testtoken&b=2026Q2`,
  };

  return { ses, tracking, sendEmailCalls };
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

    assert.equal(sendEmailCalls.length, 2, 'expect admin notify + welcome (both sendEmail)');
    assert.equal(sendEmailCalls[0].to, 'administrator@rrmacademy.org');
    assert.equal(sendEmailCalls[0].subject, 'New newsletter subscriber');
    assert.ok(sendEmailCalls[0].text.includes('jane@example.com'));
    assert.ok(sendEmailCalls[0].text.includes('source: website'));
  });

  it('welcome-unsub-url: the welcome text contains the unsubscribe URL', async () => {
    const { ses, tracking, sendEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    // sendEmailCalls[0] = admin notify, sendEmailCalls[1] = welcome
    assert.equal(sendEmailCalls.length, 2);
    const text = sendEmailCalls[1].text;
    assert.ok(
      text.includes('/api/newsletter/unsubscribe'),
      `Expected text to contain unsubscribe URL but got: ${text.slice(-200)}`
    );
  });

  it('no-secret-skips-welcome: with NEWSLETTER_SECRET unset, welcome sendEmail is NOT called but admin notify still attempted', async () => {
    const { ses, tracking, sendEmailCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: undefined });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', ses, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendEmailCalls.length, 1, 'only admin sendEmail should be called when NEWSLETTER_SECRET is missing');
    assert.equal(sendEmailCalls[0].to, 'administrator@rrmacademy.org', 'the sole call must be the admin notify');
  });

  it('failure-swallowed: an SES function that throws does not propagate out of sendSignupEmails', async () => {
    const throwingSes = {
      sendEmail: async () => { throw new Error('SES exploded'); },
    };
    const throwingTracking = {
      unsubscribeUrl: async () => { throw new Error('tracking exploded'); },
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
