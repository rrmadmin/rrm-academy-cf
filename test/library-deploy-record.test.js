/**
 * functions/api/library/deploy-record.js -- the library render surface's only
 * deployed endpoint, and the trigger that turns a published research record
 * into a rebuilt /library/<slug>/ page.
 *
 * It sits at 0% today, which means nothing verifies that a wrong secret is
 * refused, that a GitHub 5xx surfaces as 502 rather than a cheerful success, or
 * that the article id actually reaches repository_dispatch. A silent failure
 * here looks exactly like a working system: the caller gets 200, the rebuild
 * never runs, and the article is missing from the site with no error anywhere.
 *
 * WHAT IS FAKED, AND WHAT IT CANNOT DISTINGUISH
 *  - globalThis.fetch is stubbed (test/_helpers.js stubExternalFetch with a
 *    `default` route, since api.github.com is not one of the pre-routed hosts).
 *    The stub proves what this endpoint SENDS -- method, auth header, event_type,
 *    client_payload -- and how it reacts to a status code. It cannot prove
 *    GitHub accepts that payload, that the `publish` event_type is wired to a
 *    workflow, or that the PAT has repo scope. Those are properties of the
 *    GitHub side, and the instrument for them is a real dispatch.
 *  - Analytics Engine is the mockEnv stub, so log() executes and its blobs are
 *    inspectable, but nothing proves the event reaches the dataset.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockRequest, mockEnv, mockWaitUntil, parseResponse, stubExternalFetch } from './_helpers.js';

const deployRecord = await import('../functions/api/library/deploy-record.js');

const SECRET = 'deploy-secret-value';

function ctx({ body, rawBody, secret = SECRET, env = {} } = {}) {
  const events = [];
  const bag = mockEnv({ DEPLOY_SECRET: SECRET, GITHUB_DEPLOY_TOKEN: 'ghp_test', ...env });
  bag.EVENTS = { writeDataPoint: (p) => events.push(p) };
  return {
    events,
    context: {
      request: mockRequest('POST', {
        url: 'https://rrmacademy.org/api/library/deploy-record',
        headers: secret === null ? {} : { 'X-Deploy-Secret': secret },
        ...(rawBody !== undefined ? { rawBody } : { body }),
      }),
      env: bag,
      waitUntil: mockWaitUntil(),
    },
  };
}

/** api.github.com is not a pre-routed host, so route it through `default`. */
function githubStub(respond) {
  return stubExternalFetch({
    default: (call) => {
      if (!call.url.startsWith('https://api.github.com/')) throw new Error(`unexpected host: ${call.url}`);
      return respond(call);
    },
  });
}

describe('POST /api/library/deploy-record -- auth', () => {
  it('401s when the secret header is absent', async () => {
    const { context } = ctx({ body: { recordId: 'rec1' }, secret: null });
    const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
    assert.equal(status, 401);
    assert.equal(body.error, 'Unauthorized');
  });

  it('401s on a wrong secret of the same length (the compare is not a prefix match)', async () => {
    const wrong = 'deploy-secret-valuX';
    assert.equal(wrong.length, SECRET.length);
    const { context } = ctx({ body: { recordId: 'rec1' }, secret: wrong });
    assert.equal((await parseResponse(await deployRecord.onRequestPost(context))).status, 401);
  });

  it('401s on a secret that is a prefix of the real one', async () => {
    const { context } = ctx({ body: { recordId: 'rec1' }, secret: SECRET.slice(0, -1) });
    assert.equal((await parseResponse(await deployRecord.onRequestPost(context))).status, 401);
  });

  it('401s when DEPLOY_SECRET is unset, even if the caller sends an empty header', async () => {
    // The dangerous shape: unconfigured server + empty client header comparing equal.
    const { context } = ctx({ body: { recordId: 'rec1' }, secret: '', env: { DEPLOY_SECRET: undefined } });
    assert.equal((await parseResponse(await deployRecord.onRequestPost(context))).status, 401);
  });

  it('does not call GitHub on a rejected request', async () => {
    const fetchStub = githubStub(() => { throw new Error('should not be called'); });
    try {
      const { context } = ctx({ body: { recordId: 'rec1' }, secret: 'nope' });
      await deployRecord.onRequestPost(context);
      assert.equal(fetchStub.calls.length, 0);
    } finally { fetchStub.restore(); }
  });
});

describe('POST /api/library/deploy-record -- payload', () => {
  it('400s on unparseable JSON', async () => {
    const { context } = ctx({ rawBody: 'not json' });
    const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid JSON');
  });

  it('400s on an array body', async () => {
    const { context } = ctx({ rawBody: '["rec1"]' });
    const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid payload');
  });

  it('400s on a null body', async () => {
    const { context } = ctx({ rawBody: 'null' });
    assert.equal((await parseResponse(await deployRecord.onRequestPost(context))).body.error, 'Invalid payload');
  });

  it('500s when GITHUB_DEPLOY_TOKEN is missing instead of pretending to deploy', async () => {
    const { context, events } = ctx({ body: { recordId: 'rec1' }, env: { GITHUB_DEPLOY_TOKEN: undefined } });
    const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
    assert.equal(status, 500);
    assert.equal(body.error, 'GitHub token not configured');
    assert.ok(events.some(e => e.blobs.includes('deploy_record_error')));
  });
});

describe('POST /api/library/deploy-record -- dispatch', () => {
  it('sends a publish repository_dispatch carrying the record id and returns 200', async () => {
    const fetchStub = githubStub(() => ({ status: 204, text: async () => '' }));
    try {
      const { context, events } = ctx({ body: { recordId: 'recABC123' } });
      const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));

      assert.equal(status, 200);
      assert.deepEqual(body, {
        success: true,
        recordId: 'recABC123',
        message: 'Site rebuild triggered via GitHub Actions',
      });

      assert.equal(fetchStub.calls.length, 1);
      const [call] = fetchStub.calls;
      assert.equal(call.url, 'https://api.github.com/repos/rrmadmin/rrm-academy-cf/dispatches');
      assert.deepEqual(call.body, { event_type: 'publish', client_payload: { article_id: 'recABC123' } });
      assert.ok(events.some(e => e.blobs.includes('deploy_record_dispatched')));
    } finally { fetchStub.restore(); }
  });

  it('sends the required GitHub API headers', async () => {
    const seen = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { status: 204, text: async () => '' }; };
    try {
      const { context } = ctx({ body: { recordId: 'rec1' } });
      await deployRecord.onRequestPost(context);
      const { init } = seen[0];
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer ghp_test');
      assert.equal(init.headers.Accept, 'application/vnd.github+json');
      assert.ok(init.headers['User-Agent'], 'GitHub rejects requests without a User-Agent');
    } finally { globalThis.fetch = original; }
  });

  it('defaults a missing recordId to the empty string rather than sending undefined', async () => {
    const fetchStub = githubStub(() => ({ status: 204, text: async () => '' }));
    try {
      const { context } = ctx({ body: {} });
      const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
      assert.equal(status, 200);
      assert.equal(body.recordId, '');
      assert.deepEqual(fetchStub.calls[0].body.client_payload, { article_id: '' });
    } finally { fetchStub.restore(); }
  });

  it('502s when GitHub answers anything other than 204', async () => {
    for (const ghStatus of [200, 401, 404, 422, 500]) {
      const fetchStub = githubStub(() => ({ status: ghStatus, text: async () => 'gh detail' }));
      try {
        const { context, events } = ctx({ body: { recordId: 'rec1' } });
        const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
        assert.equal(status, 502, `GitHub ${ghStatus} should surface as 502`);
        assert.equal(body.error, 'GitHub dispatch failed');
        assert.equal(body.status, ghStatus);
        assert.ok(events.some(e => e.blobs.includes('deploy_record_error')));
      } finally { fetchStub.restore(); }
    }
  });

  it('still 502s when the GitHub error body cannot be read', async () => {
    const fetchStub = githubStub(() => ({ status: 500, text: async () => { throw new Error('stream broke'); } }));
    try {
      const { context } = ctx({ body: { recordId: 'rec1' } });
      assert.equal((await parseResponse(await deployRecord.onRequestPost(context))).status, 502);
    } finally { fetchStub.restore(); }
  });

  it('500s without leaking the network error message when fetch throws', async () => {
    const fetchStub = githubStub(() => { throw new Error('ECONNRESET to api.github.com'); });
    try {
      const { context, events } = ctx({ body: { recordId: 'rec1' } });
      const { status, body } = await parseResponse(await deployRecord.onRequestPost(context));
      assert.equal(status, 500);
      assert.equal(body.error, 'Deploy trigger failed');
      assert.ok(!JSON.stringify(body).includes('ECONNRESET'), 'network error text reached the client');
      // The operator still needs the detail, so it must be in the log, not the body.
      assert.ok(events.some(e => e.blobs.includes('deploy_record_error') && e.blobs.some(b => String(b).includes('ECONNRESET'))));
    } finally { fetchStub.restore(); }
  });
});
