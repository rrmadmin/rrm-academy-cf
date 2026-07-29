/**
 * ensureSid() sessionStorage-rehydration path for src/lib/fabm-quiz-engine.mjs.
 *
 * Separate file on purpose. ensureSid() memoizes the session id in module
 * scope, so only the FIRST call in a process exercises a given branch; the
 * no-storage/no-crypto fallback lives in fabm-quiz-engine.test.mjs. node:test
 * runs each test file in its own process, which gives each file a fresh module
 * registry and therefore a fresh `sid`.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const STORED_SID = 'sid-rehydrated-from-storage';
const SID_KEY = 'fabm-quiz-sid';

describe('fabm-quiz-engine -- ensureSid() rehydration from sessionStorage', () => {
  const store = new Map([[SID_KEY, STORED_SID]]);
  const writes = [];
  let ensureSid;

  before(async () => {
    globalThis.sessionStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { writes.push({ k, v }); store.set(k, v); },
    };
    ({ ensureSid } = await import('../src/lib/fabm-quiz-engine.mjs'));
  });

  after(() => {
    delete globalThis.sessionStorage;
  });

  it('reuses the id already in sessionStorage instead of minting a new one', () => {
    // This is what makes the /start/ beacon and the /results/ beacon join into
    // one anonymous session across a full page navigation.
    assert.equal(ensureSid(), STORED_SID);
  });

  it('does not rewrite storage when the id was already there', () => {
    assert.deepEqual(writes, [], `ensureSid wrote to sessionStorage: ${JSON.stringify(writes)}`);
  });

  it('serves the memoized id on subsequent calls', () => {
    store.set(SID_KEY, 'sid-changed-underneath');
    assert.equal(ensureSid(), STORED_SID, 'later calls must not re-read storage');
  });
});
