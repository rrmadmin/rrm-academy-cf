import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockEnv, mockWaitUntil, mockDB } from './_helpers.js';
import { sendSignupEmails } from '../functions/api/newsletter/_signup-emails.js';

function makeSpies() {
  const sendTrackedCalls = [];

  const trackedSpy = {
    sendTracked: async (_env, _waitUntil, opts, meta) => {
      sendTrackedCalls.push({ opts, meta });
      return { ok: true, messageId: 'msg-test' };
    },
  };

  const tracking = {
    unsubscribeUrl: async (email, _secret) =>
      `https://rrmacademy.org/api/newsletter/unsubscribe?e=${encodeURIComponent(email)}&t=testtoken&b=2026Q2`,
  };

  return { trackedSpy, tracking, sendTrackedCalls };
}

async function drainWaitUntil(waitUntil) {
  await Promise.allSettled(waitUntil.promises);
}

describe('sendSignupEmails', () => {
  it('admin-recipient: admin notification is addressed to administrator@rrmacademy.org with subject "New newsletter subscriber"', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendTrackedCalls.length, 2, 'expect admin notify + welcome (both sendTracked)');
    assert.equal(sendTrackedCalls[0].opts.to, 'administrator@rrmacademy.org');
    assert.equal(sendTrackedCalls[0].opts.subject, 'New newsletter subscriber');
    assert.ok(sendTrackedCalls[0].opts.text.includes('jane@example.com'));
    assert.ok(sendTrackedCalls[0].opts.text.includes('source: website'));
    assert.equal(sendTrackedCalls[0].meta.component, 'signup-admin-notify');
    assert.equal(sendTrackedCalls[0].meta.category, 'transactional');
  });

  it('welcome-unsub-url: the welcome text contains the unsubscribe URL', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendTrackedCalls.length, 2);
    const welcomeCall = sendTrackedCalls.find(c => c.meta.component === 'welcome');
    assert.ok(welcomeCall, 'welcome sendTracked call must exist');
    assert.ok(
      welcomeCall.opts.text.includes('/api/newsletter/unsubscribe'),
      `Expected text to contain unsubscribe URL but got: ${welcomeCall.opts.text.slice(-200)}`
    );
    assert.ok(
      welcomeCall.opts.html.includes('/api/newsletter/unsubscribe'),
      'HTML body must also contain unsubscribe URL'
    );
  });

  it('welcome-meta: welcome send uses component=welcome, category=newsletter, source=newsletter/welcome', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    const welcomeCall = sendTrackedCalls.find(c => c.meta.component === 'welcome');
    assert.ok(welcomeCall);
    assert.equal(welcomeCall.meta.category, 'newsletter');
    assert.equal(welcomeCall.meta.source, 'newsletter/welcome');
    assert.equal(welcomeCall.opts.replyTo, 'community@rrmacademy.org');
  });

  it('welcome-includes-post-link: when a post row exists, the welcome body includes the commentary link', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const db = mockDB({
      'FROM posts': { first: { title: 'The Root Cause', slug: 'the-root-cause' } },
    });
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret', DB: db });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    const welcomeCall = sendTrackedCalls.find(c => c.meta.component === 'welcome');
    assert.ok(welcomeCall, 'welcome must be sent');
    assert.ok(
      welcomeCall.opts.html.includes('https://rrmacademy.org/commentary/the-root-cause/'),
      'html must include the post URL'
    );
    assert.ok(
      welcomeCall.opts.html.includes('The Root Cause'),
      'html must include the post title'
    );
    assert.ok(
      welcomeCall.opts.text.includes('the-root-cause'),
      'text must include the slug'
    );
  });

  it('welcome-omits-post-line: when no published post exists, welcome is still sent without a post link', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const db = mockDB({
      'FROM posts': { first: null },
    });
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret', DB: db });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    const welcomeCall = sendTrackedCalls.find(c => c.meta.component === 'welcome');
    assert.ok(welcomeCall, 'welcome must still be sent even when no post exists');
    assert.ok(
      !welcomeCall.opts.html.includes('here\'s a recent piece'),
      'html must not include post line when no post'
    );
    assert.ok(welcomeCall.opts.html.includes('Warmly'), 'html must still contain closing');
  });

  it('no-secret-skips-welcome: with NEWSLETTER_SECRET unset, welcome sendTracked is NOT called but admin notify still attempted', async () => {
    const { trackedSpy, tracking, sendTrackedCalls } = makeSpies();
    const env = mockEnv({ NEWSLETTER_SECRET: undefined });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', trackedSpy, tracking);
    await drainWaitUntil(waitUntil);

    assert.equal(sendTrackedCalls.length, 1, 'only admin notify should fire when NEWSLETTER_SECRET is missing');
    assert.equal(sendTrackedCalls[0].opts.to, 'administrator@rrmacademy.org');
  });

  it('failure-swallowed: a sendTracked that throws does not propagate out of sendSignupEmails', async () => {
    const throwingTracked = {
      sendTracked: async () => { throw new Error('sendTracked exploded'); },
    };
    const throwingTracking = {
      unsubscribeUrl: async () => { throw new Error('tracking exploded'); },
    };
    const env = mockEnv({ NEWSLETTER_SECRET: 'test-secret' });
    const waitUntil = mockWaitUntil();

    sendSignupEmails(env, waitUntil, 'jane@example.com', throwingTracked, throwingTracking);

    await assert.doesNotReject(
      () => drainWaitUntil(waitUntil),
      'Failures inside sendSignupEmails must not propagate'
    );
  });
});
